/**
 * Pipeline task registration for the shared automation runner.
 *
 * The runner itself is process-wide infrastructure: it owns one timer, one
 * in-flight table, and the run records for both pipelines and desk tasks. This
 * plugin is the scheduled-task layer's registration edge — it reads
 * `finance/pipelines/*.yaml` and hands them to the runner. Unloading the row
 * (the "scheduled tasks" switch) unregisters exactly that set and aborts only
 * pipeline children; a desk task keeps its schedule and in-flight run.
 *
 * @module @deepseek-ai/dsh-automation-runner/pipeline-scheduler
 */

import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { loadPipelines } from './load.ts'

/** Stable Cordis plugin name. */
export const name = 'pipeline-scheduler'

/** Shared services required before the pipeline set can be registered. */
export const inject = ['automationRunner']

/** Locate the repository root from either `src/` (tsx) or `lib/types/` (built output). */
function defaultPipelinesDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url))
  for (const depth of ['../../../../', '../../../../../']) {
    const root = resolve(here, depth)
    if (existsSync(join(root, 'finance', 'pipelines'))) return join(root, 'finance', 'pipelines')
  }
  return resolve(here, '../../../../finance/pipelines')
}

const DEFAULT_PIPELINES_DIR = defaultPipelinesDir()

/** Plugin config: where the scheduled task definitions live. */
export interface Config {
  /** Directory of `*.yaml` pipeline definitions; a relative path resolves against the repository root. */
  readonly pipelinesDir?: string
}

/** Validate and default the pipeline-scheduler configuration. */
export const Config: z<Config> = z.object({
  pipelinesDir: z.string().default(DEFAULT_PIPELINES_DIR),
})

/**
 * Register the pipeline task set for the lifetime of this row.
 * @param ctx - plugin context carrying the shared runner.
 * @param config - validated pipeline directory.
 */
export function apply(ctx: Context, config: Config): void {
  const dir = isAbsolute(config.pipelinesDir ?? '')
    ? config.pipelinesDir!
    : resolve(DEFAULT_PIPELINES_DIR, '../..', config.pipelinesDir ?? DEFAULT_PIPELINES_DIR)
  const files = loadPipelines(dir)
  ctx.effect(() => {
    ctx.automationRunner.setPipelineTasks(files)
    return () => { ctx.automationRunner.setPipelineTasks([]) }
  }, 'pipeline-scheduler: pipeline registration')
}
