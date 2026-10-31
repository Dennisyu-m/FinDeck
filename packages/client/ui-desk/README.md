# @deepseek-ai/dsh-client-ui-desk

The value-desk page. One `settings.section` row (id `desk`) over the host `desk` Remote namespace: task list and editor, run timeline and detail, report timeline, feedback history, and the scorecard.

## Entry points

- **Tasks** — one card per task with its triggers, next fire, last run, enable toggle, immediate run, cancel, edit, and "show runs". A manual run shows Cancel run as soon as it is requested; the in-flight call does not hide that control. The editor supports the two starter templates built from the current asset library: morning brief and intraday watch. Templates derive their targets from the library; an empty library disables them with an explanation instead of inserting a machine-specific asset name. Editing loads every supported field — the full target list with each `refresh` declaration, every trigger in file order, and the whole budget — and save replaces the task with that complete draft, so changing one display name cannot drop another field.
- **Runs / Reports** — filters by task, result, and time window; run detail shows trigger, process facts (exit code, wall-clock timeout, and cancellation), cumulative usage (with an unknown-usage warning), input asset versions, deterministic signals, the four report sections, decisions, feedback actions, follow-up, and thesis adoption.
- **Feedback** — every mark with its active state, revoke, and preference reset.
- **Scorecard** — thesis checks, report usefulness, and asset activity with window, denominator, and sample count; a zero denominator renders as no-data.

## Cross-page routes

- Follow-up creates a session from `desk.reportBrief`, which carries the exact report version, run id, and the merged signal+AI input versions. Missing sources are named in the seed, never replaced with the latest version; an older report without AI-stage recording is labelled incomplete.
- Asset and thesis links route through `shell/open-section` plus the research-assets page's `assets/open` / `assets/open-thesis` events, which retain the latest request until that page mounts.

## Locale

Copy lives in `src/client/locales.ts` under `ui.desk`; the dictionaries are zh/en and the English dictionary is checked complete against the Chinese key set.

## Known Limitations and Deferred Work

- The task editor edits triggers, targets, refresh declarations, and the budget; it does not offer drag reordering, and a user who removes a trigger or target is saving that removal explicitly.
- The page does not delete task files; history stays protected.
- The row is disabled by default in the Web composition and is switched together with the host `desk` row from the Automation settings page, independently of the scheduled-tasks switch.
