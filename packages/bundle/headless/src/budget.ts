/**
 * Cumulative model-usage budget for one one-shot run.
 *
 * The budget counts provider-reported input plus output tokens across every
 * completed step; cache reads and writes are reported as separate items rather
 * than added again, because a provider may already include them in its input
 * account. A step whose attempts reported no usage makes the running total
 * incomplete: the tracker keeps counting what it did observe, marks the
 * snapshot unknown, and still stops at the cap so an unreported provider cannot
 * run unbounded.
 *
 * @module @deepseek-ai/dsh-headless/budget
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Provider token accounting for one step, as carried by a committed message. */
type StepUsage = NonNullable<SessionEvent<'assistant/message'>['data']['usage']>

/** One readable cumulative usage fact. */
export interface BudgetUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly reasoningTokens: number | null
  /** Completed model requests counted so far. */
  readonly requests: number
  /** True when any completed step reported no usage sample. */
  readonly unknown: boolean
}

/** The live budget watcher. */
export interface BudgetWatch {
  /** Stop observing the Session. */
  dispose(): void
  /** The current cumulative usage; safe to call after disposal. */
  usage(): BudgetUsage
  /** True once this watcher asked the run to stop. */
  exceeded(): boolean
}

/** The usage one attempt's stream reported, if it reported one. */
function streamUsage(stream: SessionEvent<'assistant/message'>['data']['stream']): StepUsage | undefined {
  return lastAssistantStreamChunk(stream, 'usage')?.usage
}

/** Sum a step across its attempts; a missing sample marks the step incomplete. */
interface StepAccumulator {
  usage: StepUsage | undefined
  complete: boolean
}

function addStepUsage(state: StepAccumulator, next: StepUsage | undefined): StepAccumulator {
  if (next === undefined) return { usage: state.usage, complete: false }
  if (state.usage === undefined) return { usage: next, complete: state.complete }
  const sum = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined || b === undefined ? undefined : a + b
  const totalTokens = sum(state.usage.totalTokens, next.totalTokens)
  const cacheReadTokens = sum(state.usage.cacheReadTokens, next.cacheReadTokens)
  const cacheWriteTokens = sum(state.usage.cacheWriteTokens, next.cacheWriteTokens)
  const reasoningTokens = sum(state.usage.reasoningTokens, next.reasoningTokens)
  return {
    usage: {
      inputTokens: state.usage.inputTokens + next.inputTokens,
      outputTokens: state.usage.outputTokens + next.outputTokens,
      ...totalTokens === undefined ? {} : { totalTokens },
      ...cacheReadTokens === undefined ? {} : { cacheReadTokens },
      ...cacheWriteTokens === undefined ? {} : { cacheWriteTokens },
      ...reasoningTokens === undefined ? {} : { reasoningTokens },
    },
    complete: state.complete,
  }
}

/** Add one completed step's usage into a running total. */
function addTotal(total: BudgetUsage, usage: StepUsage | undefined, complete: boolean): BudgetUsage {
  const inputTokens = total.inputTokens + (usage?.inputTokens ?? 0)
  const outputTokens = total.outputTokens + (usage?.outputTokens ?? 0)
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens: usage?.cacheReadTokens === undefined
      ? total.cacheReadTokens
      : (total.cacheReadTokens ?? 0) + usage.cacheReadTokens,
    cacheWriteTokens: usage?.cacheWriteTokens === undefined
      ? total.cacheWriteTokens
      : (total.cacheWriteTokens ?? 0) + usage.cacheWriteTokens,
    reasoningTokens: usage?.reasoningTokens === undefined
      ? total.reasoningTokens
      : (total.reasoningTokens ?? 0) + usage.reasoningTokens,
    requests: total.requests + 1,
    unknown: total.unknown || usage === undefined || !complete,
  }
}

/**
 * Watch one Agent's committed usage and request cancellation at the cap.
 * @param ctx - plugin context providing the live Session feed.
 * @param agent - the exact Agent owned by this run.
 * @param budgetTokens - positive cumulative cap in input plus output tokens.
 * @param exceeded - called once, from the step boundary that crossed the cap.
 * @returns the watcher handle.
 */
export function watchBudget(
  ctx: Context,
  agent: Agent,
  budgetTokens: number,
  exceeded: () => void,
): BudgetWatch {
  let step: StepAccumulator = { usage: undefined, complete: true }
  let total: BudgetUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    requests: 0,
    unknown: false,
  }
  let stopped = false
  const stop = ctx.on('session/event', (session: unknown, event: SessionEvent) => {
    if (session !== agent.session) return
    switch (event.type) {
      case 'assistant/attempt':
        step = addStepUsage(step, streamUsage(event.data.stream))
        return
      case 'assistant/message':
        step = addStepUsage(step, event.data.usage ?? streamUsage(event.data.stream))
        return
      case 'step/end': {
        const completed = step
        step = { usage: undefined, complete: true }
        total = addTotal(total, completed.usage, completed.complete)
        if (!stopped && total.totalTokens >= budgetTokens) {
          stopped = true
          exceeded()
        }
        return
      }
      default:
        return
    }
  })
  return {
    dispose: () => { stop() },
    usage: () => total,
    exceeded: () => stopped,
  }
}
