/**
 * Next and missed fire times for cron and interval triggers.
 * Croner's own scheduler stays paused; this module only asks it for instants.
 * @module @deepseek-ai/dsh-automation-runner
 */

import { Cron } from 'croner'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { AutomationTrigger } from './types.ts'

/** Longest single `setTimeout` delay. Longer waits wake up and read the wall clock again. */
export const SEGMENT_MS = 60_000

const crons = new Map<string, Cron>()

/**
 * A paused Croner object for one expression. Invalid expressions throw here.
 * @param schedule - five-field cron expression.
 * @param file - pipeline path named in the error.
 * @returns the cached parser.
 */
export function cronOf(schedule: string, file: string): Cron {
  const cached = crons.get(schedule)
  if (cached !== undefined) return cached
  try {
    const cron = new Cron(schedule, { paused: true })
    crons.set(schedule, cron)
    return cron
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${file}: trigger.schedule is not a cron expression: ${message}`)
  }
}

/**
 * Latest cron match at or before `now`.
 * Croner 9's `previousRun()` reports scheduler state, not the calendar, so this searches with `nextRun`.
 * @param cron - paused Croner object.
 * @param now - wall-clock milliseconds.
 * @returns the match, or `null` when the last year has none.
 */
function previousCron(cron: Cron, now: number): number | null {
  let lo = now - 366 * 24 * 60 * 60 * 1000
  let hi = now
  let best: number | null = null
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const next = cron.nextRun(new Date(mid))
    if (next === null || next.getTime() > now) {
      hi = mid - 1
      continue
    }
    best = next.getTime()
    const advanced = next.getTime() + 1
    lo = advanced > lo ? advanced : lo + 1
  }
  return best
}

/**
 * The next fire strictly after `now`, or `null` when the trigger is not armed.
 * @param trigger - task trigger.
 * @param now - wall-clock milliseconds.
 * @param anchorMs - last recorded run, used as the interval origin. `null` means the task has never run.
 * @param file - pipeline path named when cron has no future fire.
 * @returns the next fire, or `null` for `manual`.
 */
export function nextFire(
  trigger: AutomationTrigger,
  now: number,
  anchorMs: number | null,
  file: string,
): number | null {
  switch (trigger.kind) {
    case 'manual':
      return null
    case 'cron': {
      const next = cronOf(trigger.schedule, file).nextRun(new Date(now))
      if (next === null) throw new Error(`${file}: cron ${trigger.schedule} has no fire after ${new Date(now).toISOString()}`)
      return next.getTime()
    }
    case 'interval': {
      const step = trigger.everySeconds * 1000
      if (anchorMs === null) return now + step
      const steps = Math.floor((now - anchorMs) / step) + 1
      return anchorMs + steps * step
    }
    default:
      return assertNever(trigger, 'automation trigger')
  }
}

/**
 * The latest fire at or before `now` that this task has not recorded, or `null` when nothing was missed.
 * An interval with no record has no missed fire: its first fire is one interval after startup.
 * @param trigger - task trigger.
 * @param now - wall-clock milliseconds.
 * @param anchorMs - last recorded run.
 * @param file - pipeline path named in cron errors.
 * @returns the missed instant, or `null`.
 */
export function missedFire(
  trigger: AutomationTrigger,
  now: number,
  anchorMs: number | null,
  file: string,
): number | null {
  switch (trigger.kind) {
    case 'manual':
      return null
    case 'cron': {
      const at = previousCron(cronOf(trigger.schedule, file), now)
      if (at === null) return null
      if (anchorMs !== null && anchorMs >= at) return null
      return at
    }
    case 'interval': {
      if (anchorMs === null) return null
      const step = trigger.everySeconds * 1000
      if (now < anchorMs + step) return null
      const steps = Math.floor((now - anchorMs) / step)
      const at = anchorMs + steps * step
      if (at <= anchorMs || at > now) return null
      return at
    }
    default:
      return assertNever(trigger, 'automation trigger')
  }
}
