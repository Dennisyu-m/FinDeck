# @deepseek-ai/dsh-tool-desk

Desk-run tools used only by the `desk` profile: the four-section report archive and the deterministic feedback summary.

## Tools

- `desk_preferences` — reads the preference summary the desk host prepared for this run. An absent summary is reported as "no feedback yet", never as a hidden injection.
- `desk_report` — archives one report asset through `python -m findeck.desk archive-report` and finishes the run. Parameters are the four sections: `points` (1–5), `moves`, `theses`, and optional `decisions`; the host supplies the run id, session id, and the exact input asset versions from the signal record plus the child's AI-stage source ledger (`FINDECK_DESK_SOURCES_FILE`). A report archived without that ledger is marked `sourcesComplete: false` rather than claiming completeness. Failed and refused tool calls recorded in the run audit are appended to `decisions` automatically, so a permission denial cannot disappear from an unattended report.

## Run environment

The host runner sets `FINDECK_DESK_TASK`, `FINDECK_DESK_RUN_ID`, `FINDECK_DESK_RUNS_DIR`, `FINDECK_DESK_AUDIT_FILE`, `FINDECK_DESK_PREFERENCES_FILE`, `FINDECK_DESK_SOURCES_FILE`, `FINDECK_DESK_BUDGET_TOKENS`, and `FINDECK_DESK_MAX_OUTPUT_TOKENS`. The tools refuse to run when the run identity is absent; they never accept a task name, run id, or source version from the model.

## Audit

The plugin listens to `tools/result` and appends one JSONL row per failed tool call to the per-run audit file. The append is advisory: a read-only home leaves the audit missing and never changes the tool result.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `repoRoot` | repository root | Python working directory |
| `pythonPath` | repository finance venv | Archive interpreter |
| `assetDir` | `<harness home>/asset-library` | Library the archive writes |
| `deskDir` | `<harness home>/desk` | Run record root |
| `maxOutputBytes` | 256 KiB | Captured stdout/stderr per archive call |
| `graceMs` | 15000 | Termination grace for the archive child |
| `sandbox` | `false` | Whether the archive runs through `ctx.sandbox` with the asset library as its only writable root; the desk composition sets `true` and a missing sandbox fails closed |

## Known Limitations and Deferred Work

- The report archive requires the finance venv; a missing interpreter fails the tool call instead of writing a partial report.
- The audit records every failed tool result, not only permission denials; the model-facing text distinguishes them only by the tool's own message.
- The sandbox provider governs file effects, not an executable allowlist; the archive Python can start a program that does not write outside the granted roots. Archived code remains trusted input.
- Report sources are the signal inputs plus `asset_show`/`asset_run` calls; an asset that another asset reads internally is not visible and is not guessed.
