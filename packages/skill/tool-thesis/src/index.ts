/**
 * Model-facing tools over the thesis registry: register testable conclusions
 * from finished reports, list due/failed ones, show one thesis's complete
 * recheck history, and record recheck outcomes so a running hit/miss score
 * accumulates.
 *
 * The registry itself (manifest format, atomic write, derived status, overdue
 * detection, and score) belongs to `@deepseek-ai/dsh-thesis`; these tools are
 * its model-facing consumer. `allowWrite: false` omits `thesis_write`, so the
 * unattended desk composition can record rechecks without creating theses.
 *
 * @module @deepseek-ai/dsh-tool-thesis
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ThesisRecord, ThesisScore } from '@deepseek-ai/dsh-thesis'

export type {
  ThesisCheck,
  ThesisManifest,
  ThesisRecord,
  ThesisScore,
  ThesisStatus,
} from '@deepseek-ai/dsh-thesis'

export const name = 'tool-thesis'
export const inject = ['tools', 'thesis']

/** Model-facing thesis-registry tool configuration. */
export interface Config {
  /**
   * Whether this composition registers `thesis_write`. Default `true`; the
   * desk execution composition sets `false` because its permission preset
   * allows recording a recheck, not creating research components.
   */
  readonly allowWrite?: boolean
}

/** Validate and default the thesis-tool configuration. */
export const Config: z<Config> = z.object({
  allowWrite: z.boolean().default(true),
})

/** The snake_case wire view the declared output schema requires. */
function toSummaryWire(record: ThesisRecord): {
  id: string
  conclusion: string
  metric: string
  threshold: string
  due_date: string
  report: string
  assets: string[]
  status: string
  overdue: boolean
  check_count: number
} {
  return {
    id: record.id,
    conclusion: record.conclusion,
    metric: record.metric,
    threshold: record.threshold,
    due_date: record.dueDate,
    report: record.report,
    assets: [...record.assets],
    status: record.status,
    overdue: record.overdue,
    check_count: record.checks.length,
  }
}

/** Round a rate to the declared numeric precision, keeping `null` for no samples. */
function scoreToWire(score: ThesisScore): { hits: number; misses: number; hit_rate: number | null } {
  return {
    hits: score.hits,
    misses: score.misses,
    hit_rate: score.hitRate === null ? null : Number(score.hitRate.toFixed(4)),
  }
}

/**
 * Register the thesis tools the calling composition allows.
 * @param ctx - plugin context carrying the tool registry and the thesis service.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const registry = ctx.thesis
  const allowWrite = config.allowWrite ?? true

  ctx.tools.register(defineTool({
    name: 'thesis_list',
    description: 'List the registered theses (tracked, testable conclusions from past reports): each entry shows its conclusion, metric, threshold, due date, status (open/hit/miss), and whether it is overdue. Includes the registry\'s running hit/miss score.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          score: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              hits: { type: 'number', required: true },
              misses: { type: 'number', required: true },
              hit_rate: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
            },
          },
          theses: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                conclusion: { type: 'string', required: true },
                metric: { type: 'string', required: true },
                threshold: { type: 'string', required: true },
                due_date: { type: 'string', required: true },
                report: { type: 'string', required: true },
                assets: { type: 'array', required: true, items: { type: 'string' } },
                status: { type: 'string', required: true },
                overdue: { type: 'boolean', required: true },
                check_count: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderList(value.score, value.theses),
      }],
    },
    async execute() {
      return {
        dir: registry.dir,
        score: scoreToWire(await registry.score()),
        theses: (await registry.list()).map(toSummaryWire),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'List theses', kind: 'read', rawInput: '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'thesis_show',
    description:
      'Show one tracked thesis in full: its conclusion, metric, threshold, and due date, plus the COMPLETE '
      + 'recheck history — every check\'s date, hit/miss outcome, and evidence — and this thesis\'s own '
      + 'hit/miss score. Use it before rechecking (what did earlier rechecks measure?) or when writing a '
      + 'follow-up report that cites the thesis\'s track record.',
    parameters: {
      id: { type: 'string', required: true, description: 'Thesis id from `thesis_list`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          thesis: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              conclusion: { type: 'string', required: true },
              metric: { type: 'string', required: true },
              threshold: { type: 'string', required: true },
              due_date: { type: 'string', required: true },
              report: { type: 'string', required: true },
              assets: { type: 'array', required: true, items: { type: 'string' } },
              created_at: { type: 'string', required: true },
              status: { type: 'string', required: true },
              overdue: { type: 'boolean', required: true },
              checks: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    checked_at: { type: 'string', required: true },
                    outcome: { type: 'string', required: true },
                    evidence: { type: 'string', required: true },
                  },
                },
              },
              score: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  hits: { type: 'number', required: true },
                  misses: { type: 'number', required: true },
                  hit_rate: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `thesis "${value.thesis.id}" (${value.thesis.status}${value.thesis.overdue ? ', OVERDUE' : ''}, due ${value.thesis.due_date}): ${value.thesis.conclusion}`,
          `metric: ${value.thesis.metric} | threshold: ${value.thesis.threshold} | report: ${value.thesis.report}`,
          ...(value.thesis.assets.length > 0 ? [`assets: ${value.thesis.assets.join(', ')}`] : []),
          value.thesis.checks.length === 0
            ? 'no rechecks recorded yet'
            : [
              `rechecks (${String(value.thesis.checks.length)}), this thesis hit/miss ${String(value.thesis.score.hits)}/${String(value.thesis.score.misses)}:`,
              ...value.thesis.checks.map(check => `- ${check.checked_at.slice(0, 10)} [${check.outcome}] ${check.evidence}`),
            ].join('\n'),
        ].join('\n'),
      }],
    },
    async execute(args) {
      const record = await registry.get(args.id)
      if (record === undefined) throw new Error(`thesis "${args.id}" is not registered — call thesis_write first`)
      return {
        dir: registry.dir,
        thesis: {
          ...toSummaryWire(record),
          created_at: record.createdAt,
          checks: record.checks.map(check => ({
            checked_at: check.checkedAt,
            outcome: check.outcome,
            evidence: check.evidence,
          })),
          score: scoreToWire(record.score),
        },
      }
    },
    presentCall: args => ({ card: 'generic', title: `Show thesis ${args.id}`, kind: 'read', rawInput: args.id }),
  }))

  if (allowWrite) {
    ctx.tools.register(defineTool({
      name: 'thesis_write',
      description: 'Register or update one tracked thesis: a testable conclusion from a completed report, plus its evaluation metric, threshold, due date, source report path, and optional related asset names. Upsert: re-running an existing id updates the stated fields and keeps the check history.',
      parameters: {
        id: { type: 'string', required: true, description: 'Kebab-case id; re-running the same id updates the existing thesis.' },
        conclusion: { type: 'string', required: true, description: 'The testable conclusion, one sentence.' },
        metric: { type: 'string', required: true, description: 'The measure that decides the outcome.' },
        threshold: { type: 'string', required: true, description: 'The bar that separates hit from miss.' },
        due_date: { type: 'string', required: true, description: 'Recheck due date, YYYY-MM-DD.' },
        report: { type: 'string', required: true, description: 'Workspace-relative path of the report stating this conclusion.' },
        assets: { type: 'array', items: { type: 'string' }, description: 'Names of related archived assets; optional.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dir: { type: 'string', required: true },
            id: { type: 'string', required: true },
            status: { type: 'string', required: true },
            due_date: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `thesis "${value.id}" registered (status: ${value.status}, due ${value.due_date})`,
        }],
      },
      async execute(args) {
        const record = await registry.write({
          id: args.id,
          conclusion: args.conclusion,
          metric: args.metric,
          threshold: args.threshold,
          dueDate: args.due_date,
          report: args.report,
          assets: args.assets ?? [],
        })
        return { dir: registry.dir, id: record.id, status: record.status, due_date: record.dueDate }
      },
      presentCall: args => ({ card: 'generic', title: `Write thesis ${args.id}`, kind: 'edit', rawInput: args.id }),
    }))
  }

  ctx.tools.register(defineTool({
    name: 'thesis_mark',
    description: 'Record one recheck outcome for a thesis: `hit` or `miss` and the evidence. Appends to the check history, derives the new status, and returns the registry score. Use when a recheck deadline arrives (scheduled task or user request) and the evidence is real data, not an assumption.',
    parameters: {
      id: { type: 'string', required: true, description: 'Thesis id from `thesis_list`.' },
      outcome: { type: 'string', required: true, description: 'hit or miss.' },
      evidence: { type: 'string', required: true, description: 'What the recheck actually measured (dates, values, source).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          check_count: { type: 'number', required: true },
          score: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              hits: { type: 'number', required: true },
              misses: { type: 'number', required: true },
              hit_rate: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `thesis "${value.id}" → ${value.status} (checks: ${String(value.check_count)}); score hit/miss ${String(value.score.hits)}/${String(value.score.misses)} (hit rate ${value.score.hit_rate === null ? 'n/a' : `${(value.score.hit_rate * 100).toFixed(1)}%`})`,
      }],
    },
    async execute(args) {
      if (args.outcome !== 'hit' && args.outcome !== 'miss') {
        throw new Error(`outcome must be "hit" or "miss", got "${args.outcome}"`)
      }
      const record = await registry.mark(args.id, args.outcome, args.evidence)
      return {
        id: record.id,
        status: record.status,
        check_count: record.checks.length,
        score: scoreToWire(await registry.score()),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Mark thesis ${args.id}`, kind: 'other', rawInput: args.id }),
  }))
}

type RenderThesis = {
  id: string
  conclusion: string
  metric: string
  threshold: string
  due_date: string
  report: string
  status: string
  overdue: boolean
}

function renderList(
  score: { hits: number; misses: number; hit_rate: number | null },
  theses: readonly RenderThesis[],
): string {
  const scoreLine = score.hit_rate === null
    ? `no checks yet (hit/miss: ${String(score.hits)}/${String(score.misses)})`
    : `hit/miss: ${String(score.hits)}/${String(score.misses)} · hit rate ${(score.hit_rate * 100).toFixed(1)}%`
  if (theses.length === 0) {
    return `Thesis registry is empty. Register testable conclusions from finished reports with thesis_write. (${scoreLine})`
  }
  return [
    `Tracked theses (${scoreLine}):`,
    ...theses.map(thesis =>
      `- \`${thesis.id}\`: ${thesis.conclusion} [metric: ${thesis.metric}, threshold: ${thesis.threshold}, due: ${thesis.due_date}, status: ${thesis.status}${thesis.overdue ? ', OVERDUE' : ''}, report: ${thesis.report}]`,
    ),
  ].join('\n')
}
