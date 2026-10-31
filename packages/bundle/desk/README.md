# @deepseek-ai/dsh-desk-app

The unattended desk-run bundle. It layers over `dsh-base` and `dsh-headless`; its one job is to narrow the one-shot agent composition to the desk permission set.

## Composition

`cordis.patch.yml` removes shell, filesystem writes, background asset runs, subagents, workflows, the web tools, memory notes, goal/plan state, and the tools that create research components. It keeps reading the asset library, a foreground `asset_run`, thesis reads and `thesis_mark`, skills, `rb_check`, the desk tools, and the headless runner.

The runner row reads its run budget and per-request output cap from `FINDECK_DESK_BUDGET_TOKENS` and `FINDECK_DESK_MAX_OUTPUT_TOKENS`; the desk host executor sets both for each run. `approval.policy` is `never` because nobody is present to answer, so a call that would ask is refused and the refusal reaches the run audit.

## Launch

The profile template is `desk`, composed as `dsh-base` + `dsh-headless` + `dsh-desk-app`:

```sh
dsh --profile desk -            # task text on stdin, JSON event stream on stdout
```

The host runner starts it through `apps/cli/lib/bin.js`; nothing else launches this composition.

## Security boundary

The guard is the tool set and the sandbox/approval configuration, not prompt text. `asset_run` runs in the finance Python environment; the report archive runs the repository's `python -m findeck.desk archive-report`, whose `--task`, `--run-id`, and source versions are supplied by the host, never by the model. `asset_run_bg` is absent, so a detached submission cannot outlive the run's budget or cancellation.

## Known Limitations and Deferred Work

- `asset_run` and `desk_report` spawn Python through `ctx.sandbox`, with the asset library as the only writable root. On Windows that backend limits file writes; it is not an executable allowlist and it does not isolate reads or the network. The host runner's no-interpretation archive uses the same confinement.
- The composition has no human approval answerer by design. A future Bot layer that adds one must revisit `approval.policy`.
