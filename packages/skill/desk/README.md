# @deepseek-ai/dsh-desk

Desk task management for FinDeck's value desk. This package owns the one write and read path over `~/.findeck/desk`: the `desk_list` / `desk_show` / `desk_write` model tools and the Web desk page both call this service, so validation, atomic writes, enable toggles, immediate runs, cancellation, event triggers, and due-date triggers have a single implementation.

## Service

`ctx.desk` provides:

| Group | Methods |
|---|---|
| Tasks | `list`, `show`, `write`, `setEnabled`, `runNow`, `cancel` |
| Runs | `runs`, `runDetail` |
| Reports | `reportBrief`, `setDecision` |
| Feedback | `feedback`, `feedbackList`, `revokeFeedback`, `resetPreferences` |
| Thesis | `adoptThesis`, scorecard |
| Templates | `templates` |

The shared scheduler (`ctx.automationRunner`) executes the tasks; this service registers each validated task and unregisters the whole desk set on unload. The runner row stays mounted in both switch states: turning the desk switch off stops desk scheduling and cancels desk runs without touching the pipeline set, and turning the scheduled-tasks switch off unloads only the separate pipeline-scheduler row.

## Task files

`<deskDir>/tasks/<name>.yaml`, defaulting to `~/.findeck/desk/tasks`, use the format documented by [`finance/python/findeck/desk.py`](../../../finance/python/findeck/desk.py): `name`, `display_name`, `goal`, optional `enabled`, non-empty `targets` (symbol / theme / thesis / asset / workbench, each with an optional `refresh`), non-empty `trigger` (cron / interval / event / thesis-due), `report` (`always` or `changes`), `budget` (`tokens`, `wallSeconds`, optional `maxOutputTokens`), and `proposed_by: user`.

A write serializes the complete spec, writes it to a scratch directory, runs `python -m findeck.desk validate`, and only then atomically replaces the real file. An unknown field, a name collision with a pipeline, or an existing file that is not a currently valid task is refused instead of overwritten. Existing files without `enabled` load as enabled.

## Runs

Every run writes one JSONL log at `<deskDir>/runs/<task>.jsonl` with four kinds of line sharing one `runId`: `started`, `signal`, `report`, and `finished`. Readers merge by `runId`; the finished line carries the process facts, the archived report, the merged signal+AI input asset versions, cumulative usage, and a stop reason. A run that crashed after `started` remains visible as running.

`status` distinguishes `ok`, `degraded` (a no-interpretation report was archived), `no-change`, `data-insufficient`, `budget`, `timeout`, `cancelled`, `failed`, `skipped`, and `running`. `stopReason` stays separate from the process exit code.

## Triggers

- Cron and interval are armed by the shared runner.
- `event` names the authenticated webhook adapter kind. The service registers one trusted rule per enabled kind on `ctx.webhookRuntime`; a delivery calls the runner's normal desk entry, so concurrency and accounting are shared. Repeated deliveries are not deduplicated by the runtime; the run record carries the provider delivery id.
- `thesis-due` is checked every `thesisCheckSeconds`, only for the task's own `thesis` targets. One `(task, thesis, dueDate)` key is written to `<deskDir>/triggers.jsonl` as `started` before the run, then `consumed` only after an `ok` run whose due thesis actually has a new check; a failed, cancelled, or interrupted attempt stays retryable up to `thesisMaxAttempts` (default 3). A running task is skipped without consuming, and overlapping ticks cannot overlap. A due-only `changes` run still produces a report: the due date is the change that justified it.

## Feedback and scorecard

Feedback is append-only in `<deskDir>/feedback.jsonl`: a `set` row binds task, run, report asset, and report version; a `revoke` row points at a set id. `preferences.json` records the last reset instant; earlier feedback stays visible but stops shaping `preferencesText`, the deterministic summary the desk profile reads through `desk_preferences`.

The scorecard reports thesis checks, report usefulness, and asset activity with an explicit window, denominator, and sample count; a zero denominator renders as `null` rather than `0%`. It is a run/feedback statistic, not an investment-return claim.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `tasksDir` | `<deskDir>/tasks` | Task YAML directory |
| `deskDir` | `<harness home>/desk` | Runs, feedback, ledgers |
| `assetDir` | `<harness home>/asset-library` | Library the templates and briefs read |
| `pythonPath` | repository finance venv | Validator and archive interpreter |
| `repoRoot` | repository root | Python working directory |
| `maxRunsReadBytes` | 8 MiB | Tail read bound for run logs |
| `maxRunRecords` | 500 | Records one query returns |
| `preferenceWindowDays` | 30 | Feedback window that shapes interpretation |
| `preferenceSuppressionMin` | 2 | Useless marks before a source is de-prioritised |
| `thesisCheckSeconds` | 300 | Due-date poll interval |
| `thesisMaxAttempts` | 3 | Attempts per due key before an errored run stops retrying |
| `templateTokens` / `templateWallSeconds` | 20000 / 600 | Budgets the two templates propose |

## Known Limitations and Deferred Work

- The validator is executed for every task file on each reload; a fresh page load on a machine without the finance venv reports validator-unavailable problems instead of falling back to a second validator.
- A run's report line is appended by the Python archive; if the process dies between archiving and appending, the asset exists without a run association. The run's finished line remains authoritative for the model half.
- Event triggers rely on a separately mounted authenticated adapter (`@deepseek-ai/dsh-webhook-github` or a deployment's own); this package consumes the runtime but ships no secret or route.
- The page offers no task deletion; editing or removing files on disk is deliberate.
- Report source recording depends on `asset_show`/`asset_run` in the desk child appending to the run's source ledger. A report without the ledger path, or an older report, is marked `sourcesComplete: false`; the page and follow-up seed state this instead of guessing from latest versions.
- The thesis-due retry counter is per `(task, thesis, dueDate)`; a permanently failing run stops after `thesisMaxAttempts` and remains visible as a failed run, not as a silently consumed trigger.
