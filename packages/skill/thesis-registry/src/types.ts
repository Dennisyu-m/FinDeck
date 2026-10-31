/**
 * Thesis-registry vocabulary shared by the service, the model-facing tools, and
 * the desk scorecard.
 * @module @deepseek-ai/dsh-thesis/types
 */

/** One recorded recheck. */
export interface ThesisCheck {
  /** ISO instant the check was recorded. */
  readonly checkedAt: string
  /** Whether the stated metric met the threshold. */
  readonly outcome: 'hit' | 'miss'
  /** What the recheck actually measured. */
  readonly evidence: string
}

/** One stored thesis manifest, as the registry reads it. */
export interface ThesisManifest {
  /** Kebab-case identity, equal to the file stem. */
  readonly id: string
  /** The testable conclusion, one sentence. */
  readonly conclusion: string
  /** The measure that decides the outcome. */
  readonly metric: string
  /** The bar separating hit from miss. */
  readonly threshold: string
  /** Recheck due date, `YYYY-MM-DD`. */
  readonly dueDate: string
  /** Workspace-relative path of the report that stated the conclusion. */
  readonly report: string
  /** Related archived asset names. */
  readonly assets: readonly string[]
  /** Creation instant. */
  readonly createdAt: string
  /** Complete recheck history in append order. */
  readonly checks: readonly ThesisCheck[]
}

/** Derived state of one thesis. */
export type ThesisStatus = 'open' | 'hit' | 'miss'

/** One thesis plus the status facts every consumer derives the same way. */
export interface ThesisRecord extends ThesisManifest {
  /** Newest check's outcome, or `open` before any check. */
  readonly status: ThesisStatus
  /** Due date has passed with no check dated at or after it. */
  readonly overdue: boolean
  /** This thesis's own hit/miss counts. */
  readonly score: ThesisScore
}

/** Hit/miss counts over a set of checks. */
export interface ThesisScore {
  readonly hits: number
  readonly misses: number
  /** `null` while no check exists. */
  readonly hitRate: number | null
}

/** Fields a caller supplies when upserting one thesis. */
export interface ThesisWriteInput {
  readonly id: string
  readonly conclusion: string
  readonly metric: string
  readonly threshold: string
  readonly dueDate: string
  readonly report: string
  readonly assets?: readonly string[]
}

/** Plugin configuration for the registry. */
export interface Config {
  /** Registry root; defaults to `<harness home>/asset-library/theses`. */
  readonly thesesDir?: string
}
