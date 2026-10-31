---
description: "Shared host scheduler for FinDeck pipeline and value-desk tasks. One timer and one in-flight table serve both layers; each layer registers and unregisters its own task set through its own Loader row."
kind: "package-reference"
---

# @deepseek-ai/dsh-automation-runner

English | [中文](README.zh.md)

## Summary

`dsh-automation-runner` is the shared host scheduler for pipeline tasks and value-desk tasks. It owns one timer and one in-flight table; it does not read either task source itself. `@deepseek-ai/dsh-automation-runner/pipeline-scheduler` reads `finance/pipelines/*.yaml` and calls `setPipelineTasks`; `@deepseek-ai/dsh-desk` reads desk tasks and calls `setDeskTasks`. A pipeline fire runs `python -m findeck.pipeline run <path>` through `ctx.subprocess`; a desk fire runs `python -m findeck.desk run <path>` and then one `dsh --profile desk --json -` session bounded by the task's cumulative token budget and wall clock. `list`, `runNow`, `setPipelineTasks`, `setDeskTasks`, `runDeskTask`, `cancelDeskTask`, and `isDeskRunning` are the host API. The plugin registers no model tool, prompt section, or session event.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount it on a long-lived host that already has `ctx.subprocess`. The shipped base bundle does that. The headless, sdk, and acp bundles disable the row, because a live timer would keep those one-shot processes from exiting. In the Web composition the runner stays mounted for both switch layers: the scheduled-tasks group disables the separate `pipeline-scheduler` row, and the desk group disables the `@deepseek-ai/dsh-desk` row. Neither switch unloads the shared runner, so the other layer keeps its schedule.

```yaml
- id: automation-runner
  name: '@deepseek-ai/dsh-automation-runner'

- id: pipeline-scheduler
  name: '@deepseek-ai/dsh-automation-runner/pipeline-scheduler'
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `deskRunsDir` | `<harness home>/desk/runs` | Desk run logs. A relative path resolves against `repoRoot`. |
| `repoRoot` | the repository that contains this package | Working directory of the Python children and the desk profile. |
| `pythonPath` | `finance/python/.venv` interpreter for this OS | Interpreter. A relative path resolves against `repoRoot`. |
| `cliBin` | `<repo>/apps/cli/lib/bin.js` | Built dsh entry used for the desk profile. |
| `deskProfile` | `desk` | Profile name of the desk execution composition. |
| `assetDir` | `<harness home>/asset-library` | Passed to the child as `FINDECK_ASSET_DIR`. A relative path resolves against the harness home. |
| `timeoutMs` | `1800000` | Wall-clock budget for one pipeline process. Expiry aborts the child and is recorded separately from the exit code. |
| `catchUp` | `latest` | On the process's first pipeline registration, run the single latest missed fire. `none` waits for the next future fire. |
| `stderrTailBytes` | `8192` | Stderr bytes copied onto a run record. |
| `graceMs` | `15000` | Grace `ctx.subprocess` gets after abort. |
| `deskMaxOutputTokens` | `2048` | Per-request output cap when a task states none. |
| `archiveTimeoutMs` | `120000` | Upper bound for one no-interpretation report archive after the run's own wall clock. |
| `deskMovePct` / `deskVolumeRatio` / `deskFreshnessMaxAgeDays` | `0.03` / `2` / `7` | Deterministic signal thresholds passed to `findeck.desk run`. |
| `deskSignalMaxBytes` | `1048576` | Captured stdout of the signal step and the archive child. |
| `deskLogReadMaxBytes` | `8388608` | Tail window used to find this run's report line. |

The `pipeline-scheduler` row takes `pipelinesDir` (default `<repo>/finance/pipelines`, relative paths resolve against the repository root). A missing directory, a yaml file that does not match the trigger rules below, or a cron expression Croner rejects fails that row's load, not the runner's.

### Triggers

`manual` is listed and accepts `runNow`. It is not armed.

`cron` uses a five-field expression in the host's local timezone: `{ kind: cron, schedule: "0 17 * * 1-5" }`.

`interval` uses a positive integer number of seconds: `{ kind: interval, everySeconds: 3600 }`. The origin is the timestamp of the latest `pipeline-runs` line. A file with no line waits one full interval before the first fire.

### Run record

Each fire appends one line to `<assetDir>/pipeline-runs/<name>.jsonl` after the child exits. The line keeps the python step-record keys (`ts`, `pipeline`, `step`, `status`, `produced`, `inputs`, `duration_s`) and adds `exitCode`, `timedOut`, `signal`, and `stderrTail`. Python's own step lines are not rewritten. `status` is `ok`, `failed`, or `skipped`. A second fire while the same name is in flight, including across a reload that has not finished disposing the previous process, is `skipped` and does not spawn. Failures are not retried; the next fire is the next future slot.

`catchUp: latest` runs at most one missed slot per task at startup. Older missed slots are not replayed.

Unload sets the runner closed, aborts in-flight children, waits until those children exit, and then clears the timer.

### Desk runs

A desk run writes several lines to `<deskRunsDir>/<task>.jsonl`, all sharing one `runId`:

1. `step: runner`, `event: started` — trigger, start time.
2. `step: signal` — written by the Python signal step: signals, refresh results, input asset versions, thresholds.
3. `step: report` — written by the report archive: asset, version, tags, fallback flag.
4. `step: runner`, `event: finished` — status, stop reason, process facts, session id, report association, inputs, cumulative usage, error and stderr tail.

`readRunLog` and `mergeDeskRuns` are exported so one reader merges by run id. The finished line carries every field a consumer needs, so no consumer guesses an outcome from the last line.

When the desk session does not archive a report, the runner writes a no-interpretation report through `ctx.sandbox`: `workspace-write` rooted at the asset library, `python -m findeck.desk archive-report --no-record`, then the host appends the returned report line to the desk run log. A missing sandbox service refuses that archive instead of writing unconfined. The Windows backend limits file writes; it is not an executable allowlist and it does not isolate reads or the network.

Statuses: `ok`, `degraded` (a no-interpretation report was archived), `no-change` (a `changes` task with no moved signal; no model call), `data-insufficient`, `budget`, `timeout`, `cancelled`, `failed`, `skipped`, `running`. The process exit code, timeout flag, cancellation flag, and stop reason are independent fields. When cancel, task removal, or unload has run, the status is `cancelled` even if the wall clock also expired or the child exited non-zero; a non-zero exit without that cancel stays `failed`, or `timeout` when only the wall clock fired. Cancel aborts the current child and the run record is written after that child exits. It does not start the model child, and it does not start a no-interpretation archive, including when cancel arrives while that archive is creating its temp directory; a report already archived is kept. A wall-clock timeout that ends before the model child still archives that fallback under `archiveTimeoutMs`.

### Host API

`list()` returns pipeline rows and registered desk rows with name, kind, display trigger, next fire, and latest run line.

`runNow(name)` runs one pipeline immediately; `runDeskTask(name, trigger)` runs one desk task through the manual, event, or due-date entry; `cancelDeskTask(name)` marks a run cancelled and aborts its child.

`setDeskTasks(tasks)` replaces the complete desk set. A removed or renamed task's in-flight run is aborted; editing a task keeps its current run, which continues on the snapshot taken at start. Turning the desk layer off is `setDeskTasks([])`, which leaves the pipeline set armed.

-----

<a id="model-experience"></a>
## Model Experience

None, as this plugin registers no model tool, prompt section, or session event.

#### KV Cache effect

The runner issues no model request and writes no session event, so it does not change a reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Desk execution needs the built CLI** — the runner spawns `apps/cli/lib/bin.js --profile desk`; a source-only checkout must be built before a desk run can start.
- **The no-interpretation archive is outside the wall clock** — the run's wall timer covers the signal step and the model child. If the model child is aborted, the fallback archive runs under its own bounded `archiveTimeoutMs`, because a degraded report must still be written after a timeout. That archive is still confined to the asset library.
- **Source recording is host-tool owned** — the desk child records the versions `asset_show` and `asset_run` successfully resolved; an archive that did not receive `--sources-file` is marked `sourcesComplete: false` instead of inventing versions.
- **Event and thesis-due are not armed here** — the desk service owns those triggers and calls `runDeskTask`; the runner only arms cron and interval.
- **Interval origin is the latest finished run** — a task with no finished line does not catch up; it waits one interval.
- **A newly registered trigger does not replay a missed fire** — enabling a desk task starts at its next future fire; only pipelines keep the startup `catchUp` behavior.
- **Disabled on one-shot profiles** — headless, sdk, and acp ship the row disabled. A composition that enables it there keeps the process alive for as long as a timer is armed.
- **A removed task's run is aborted, an edit is not** — changing a task's fields affects the next run; explicit cancellation is the only way to stop the current one, except when the whole desk set is unregistered.
