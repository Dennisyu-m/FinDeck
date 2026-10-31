/**
 * Desk-run tools: the report archive and the deterministic feedback summary.
 *
 * These tools exist only in the `desk` profile. The runner passes the run
 * identity, record directory, and audit file through the child environment;
 * the report tool never accepts a run id, task, or source version from the
 * model, so a report cannot be attributed to another run or claim versions the
 * run did not read. `desk_report` archives through `python -m findeck.desk
 * archive-report`, the same command the host uses for the no-interpretation
 * fallback.
 *
 * The plugin also records failed tool calls into the run's audit file. A
 * permission denial reaches the model as an error result; the report tool
 * turns those audit rows into "decisions for the user" so an unattended run
 * never silently drops a refused action.
 *
 * @module @deepseek-ai/dsh-tool-desk
 */

import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'

export const name = 'tool-desk'
export const inject = ['tools', 'subprocess']

/* v8 ignore start -- POSIX lanes exercise the venv bin/ peer; Windows always resolves the Scripts/ path. */
const VENV_PYTHON_REL = process.platform === 'win32'
  ? 'finance/python/.venv/Scripts/python.exe'
  : 'finance/python/.venv/bin/python'
/* v8 ignore stop */
const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const DEFAULT_PYTHON_PATH = fileURLToPath(new URL(`../../../../${VENV_PYTHON_REL}`, import.meta.url))

/** Plugin configuration. Paths are deployment choices and all validate. */
export interface Config {
  /** Repository root used as the Python working directory. */
  readonly repoRoot?: string
  /** Finance venv interpreter. */
  readonly pythonPath?: string
  /** Asset library root; defaults to `<harness home>/asset-library`. */
  readonly assetDir?: string
  /** Desk record root; defaults to `<harness home>/desk`. */
  readonly deskDir?: string
  /** Per-stream collected output cap in bytes. */
  readonly maxOutputBytes?: number
  /** Termination grace for the archive child process, in milliseconds. */
  readonly graceMs?: number
  /**
   * Whether the report archive must run inside the composed sandbox with the
   * asset library as its only writable root. The unattended desk composition
   * sets `true`; an unavailable sandbox fails the tool instead of writing the
   * report unconfined.
   */
  readonly sandbox?: boolean
}

/** Validate and default the desk tool configuration. */
export const Config: z<Config> = z.object({
  repoRoot: z.string().default(DEFAULT_REPO_ROOT),
  pythonPath: z.string().default(DEFAULT_PYTHON_PATH),
  assetDir: z.string().default(''),
  deskDir: z.string().default(''),
  maxOutputBytes: z.number().default(256 * 1024),
  graceMs: z.number().default(15_000),
  sandbox: z.boolean().default(false),
})

/** One failed or denied tool call recorded for the report's decisions section. */
interface AuditRow {
  readonly ts: string
  readonly tool: string
  readonly message: string
}

/** Resolve the run identity from the environment the runner set for this child. */
function runIdentity(): { task: string; runId: string; runsDir: string; auditFile: string | undefined } {
  const task = process.env.FINDECK_DESK_TASK ?? ''
  const runId = process.env.FINDECK_DESK_RUN_ID ?? ''
  const runsDir = process.env.FINDECK_DESK_RUNS_DIR ?? ''
  if (task === '' || runId === '' || runsDir === '') {
    throw new Error('desk tools are only available inside a desk run (missing FINDECK_DESK_TASK/RUN_ID/RUNS_DIR)')
  }
  const audit = process.env.FINDECK_DESK_AUDIT_FILE
  return { task, runId, runsDir, auditFile: audit === undefined || audit === '' ? undefined : audit }
}

/** Text of one tool result's model-facing content, bounded. */
function resultText(content: readonly { type: string; text?: string }[]): string {
  const text = content
    .filter((block): block is { type: string; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
}

/** Read the audit rows, tolerating a truncated final line. */
async function readAudit(file: string | undefined): Promise<AuditRow[]> {
  if (file === undefined) return []
  let text: string
  try {
    text = await readFile(file, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const rows: AuditRow[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as Partial<AuditRow>
      if (typeof parsed.tool === 'string' && typeof parsed.message === 'string') {
        rows.push({ ts: typeof parsed.ts === 'string' ? parsed.ts : '', tool: parsed.tool, message: parsed.message })
      }
    } catch {
      // A truncated trailing line from a killed child is not an audit row.
    }
  }
  return rows
}

/** Append one audit row; the audit is a side channel that never fails the tool call. */
async function recordAudit(file: string | undefined, row: AuditRow): Promise<void> {
  if (file === undefined) return
  try {
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify(row)}\n`, 'utf-8')
  } catch {
    // The append is the only statement in the `try`; a read-only home leaves
    // the audit missing and never changes the tool result that produced it.
  }
}

/**
 * Register the desk tools and the audit listener.
 * @param ctx - plugin context carrying the tool registry and subprocess seam.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const pythonPath = resolve(config.pythonPath ?? DEFAULT_PYTHON_PATH)
  const repoRoot = resolve(config.repoRoot ?? DEFAULT_REPO_ROOT)
  const assetDir = config.assetDir !== undefined && config.assetDir !== ''
    ? resolve(config.assetDir)
    : dshHomePath('asset-library')
  const deskDir = config.deskDir !== undefined && config.deskDir !== ''
    ? resolve(config.deskDir)
    : dshHomePath('desk')

  ctx.on('tools/result', (exec, result) => {
    if (!result.isError) return
    if (exec.name === 'desk_preferences') return
    void recordAudit(process.env.FINDECK_DESK_AUDIT_FILE, {
      ts: new Date().toISOString(),
      tool: exec.name,
      message: resultText(result.content),
    })
  })

  ctx.tools.register(defineTool({
    name: 'desk_preferences',
    description:
      'Read the deterministic summary of recent user feedback for this desk task: which sources were marked '
      + 'useful or useless, which runs were handled, and which signals the user asked to de-prioritise. '
      + 'Call it before interpreting signals. An empty summary means no feedback exists yet.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      const file = process.env.FINDECK_DESK_PREFERENCES_FILE
      if (file === undefined || file === '') {
        return { text: 'No feedback summary was prepared for this run; interpret signals without preference weighting.' }
      }
      let text: string
      try {
        text = (await readFile(file, 'utf-8')).trim()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { text: 'No feedback exists yet for this task; interpret signals without preference weighting.' }
        }
        throw error
      }
      return { text: text === '' ? 'No feedback exists yet for this task.' : text }
    },
    presentCall: () => ({ card: 'generic', title: 'Read desk preferences', kind: 'read', rawInput: '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'desk_report',
    description:
      'Archive this run\'s four-section report as a report asset and finish the run. Sections: points (1–5 '
      + 'one-line conclusions), moves (what the signals mean and what would falsify it), theses (which theses '
      + 'were rechecked and the result), decisions (what the user must decide). The host adds the run id, '
      + 'session id, and the exact input asset versions read by the run; never guess them. Call it once.',
    parameters: {
      title: { type: 'string', description: 'Report title, e.g. "2026-10-23 晨报".' },
      points: { type: 'array', items: { type: 'string' }, description: '1–5 conclusions, each one line.' },
      moves: { type: 'string', description: 'Signal interpretation: size, plausible cause, and disconfirming evidence.' },
      theses: { type: 'string', description: 'Thesis rechecks: which ids were marked and the measured evidence.' },
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true },
            text: { type: 'string', required: true },
          },
        },
        description: 'Items for the user: refused calls, overturned conclusions, suggested target changes.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          asset: { type: 'string', required: true },
          version: { type: 'number', required: true },
          dir: { type: 'string', required: true },
          fallback: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Report archived as ${value.asset}@v${String(value.version)} (${value.fallback ? 'no-interpretation' : 'interpreted'}) → ${value.dir}`,
      }],
    },
    async execute(args, exec) {
      const { task, runId, runsDir, auditFile } = runIdentity()
      const points = (args.points ?? []).map(point => point.trim()).filter(point => point !== '')
      if (points.length === 0) throw new Error('desk_report requires at least one point')
      if (points.length > 5) throw new Error(`desk_report accepts at most 5 points, got ${String(points.length)}`)
      if (typeof args.moves !== 'string' || args.moves.trim() === '') {
        throw new Error('desk_report requires a non-empty moves section')
      }
      if (typeof args.theses !== 'string' || args.theses.trim() === '') {
        throw new Error('desk_report requires a non-empty theses section')
      }
      const decisions = (args.decisions ?? []).map((item, index) => {
        const kind = item.kind.trim()
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(kind)) {
          throw new Error(`desk_report decisions[${String(index)}].kind must be kebab-case`)
        }
        if (item.text.trim() === '') throw new Error(`desk_report decisions[${String(index)}].text is empty`)
        return { kind, text: item.text.trim() }
      })
      for (const row of await readAudit(auditFile)) {
        decisions.push({ kind: 'permission', text: `工具 ${row.tool} 调用失败或被拒：${row.message}` })
      }
      const payload = {
        title: args.title?.trim() ?? '',
        points,
        moves: args.moves,
        theses: args.theses,
        decisions,
        sessionId: exec.agent?.session.id,
        fallback: false,
      }
      const scratch = await mkdtemp(join(tmpdir(), 'findeck-desk-payload-'))
      try {
        const payloadFile = join(scratch, 'payload.json')
        await writeFile(payloadFile, JSON.stringify(payload, null, 2), { mode: 0o600 })
        const sourcesFile = process.env.FINDECK_DESK_SOURCES_FILE
        const baseArgv = [
          pythonPath, '-m', 'findeck.desk', 'archive-report',
          '--task', task, '--run-id', runId, '--runs-dir', runsDir,
          '--asset-dir', assetDir, '--payload', payloadFile,
          '--no-record',
          ...sourcesFile === undefined || sourcesFile === '' ? [] : ['--sources-file', sourcesFile],
        ]
        let argv: readonly string[] = baseArgv
        if (config.sandbox ?? false) {
          const sandbox = ctx.get('sandbox') as SandboxProvider | undefined
          if (sandbox === undefined) {
            throw new Error('desk report archive requires the sandbox service, but this composition has none; refusing to write unconfined')
          }
          const policy: SandboxPolicy = {
            mode: 'workspace-write',
            workspaceRoot: assetDir,
            ...exec.agent === undefined ? {} : { sessionId: exec.agent.session.id },
          }
          argv = (await sandbox.confine(baseArgv, policy, exec.signal)).argv
        }
        const handle = ctx.subprocess.spawn({
          argv,
          cwd: repoRoot,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: config.maxOutputBytes ?? 256 * 1024 },
            stderr: { maxBytes: config.maxOutputBytes ?? 256 * 1024 },
          },
          graceMs: config.graceMs ?? 15_000,
          signal: exec.signal,
          env: {
            FINDECK_ASSET_DIR: assetDir,
            FINDECK_DESK_DIR: deskDir,
            PYTHONIOENCODING: 'utf-8',
          },
        })
        const outcome = await handle.done
        const stdout = (handle.collected.stdout?.readFrom(0).text ?? '').trim()
        const stderr = (handle.collected.stderr?.readFrom(0).text ?? '').trim()
        if (outcome.exitCode !== 0) {
          throw new Error(`desk.report archive failed: ${stderr || stdout || `exit code ${String(outcome.exitCode)}`}`)
        }
        const line = stdout.split(/\r?\n/u).at(-1) ?? ''
        let parsed: {
          asset?: unknown
          version?: unknown
          dir?: unknown
          fallback?: unknown
          line?: unknown
        }
        try {
          parsed = JSON.parse(line) as typeof parsed
        } catch {
          throw new Error(`desk.report archive produced no result line; stdout: ${stdout || '(empty)'}`)
        }
        if (typeof parsed.asset !== 'string' || typeof parsed.version !== 'number' || typeof parsed.dir !== 'string') {
          throw new Error(`desk.report archive result is malformed: ${line}`)
        }
        const record = parsed.line
        if (typeof record !== 'object' || record === null
          || (record as Record<string, unknown>).runId !== runId
          || (record as Record<string, unknown>).task !== task) {
          throw new Error('desk.report archive returned no run record line for this run')
        }
        await mkdir(runsDir, { recursive: true, mode: 0o700 })
        await appendFile(join(runsDir, `${task}.jsonl`), `${JSON.stringify(record)}\n`, 'utf-8')
        return {
          asset: parsed.asset,
          version: parsed.version,
          dir: parsed.dir,
          fallback: parsed.fallback === true,
        }
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Archive desk report',
      kind: 'other',
      rawInput: args.title ?? '',
    }),
  }))
}
