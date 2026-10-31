---
description: "The model-facing FinDeck asset-library tools for users and maintainers discovering, searching, inspecting, and re-running archived research assets inside the finance Python environment."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-asset-library

English | [中文](README.zh.md)

## Summary

Research sessions leave reusable artifacts — trained models, downloaded weights, and code modules — archived in the user's global FinDeck asset library. This consumer package gives every agent seven tools over that library: `asset_dir` reports the root, `asset_list` summarizes assets (optionally filtered by a case-insensitive `query` over name/description/dependencies and by `kind`) with their validation metrics, `asset_search` retrieves assets by structured conditions (query, kind, origin, tag, verb, dependency) and returns each match's path, `asset_show` returns one asset's manifest, files, and code preview, `asset_graph` returns one asset's transitive dependency closure and reverse dependents, `asset_run` executes an asset entry inside the finance Python virtual environment behind the approval seam, and `asset_run_bg` submits a verb as a detached background run and returns as soon as it is accepted. Before the first request, agents also receive a durable asset catalog listing every available asset, published through the session-catalog machinery shared with the skill catalog. The library layout and `manifest.yaml` format are owned by `finance/python/findeck/assets.py`; this package only reads the machine-readable `index.json` that module rebuilds on every archive — index version 2, whose entries add `origin`, `verbs`, `freshness`, `lineage`, `tags`, and `face`, and version 1, whose entries are read with those fields defaulted. Every successful `asset_search`, `asset_show`, `asset_run`, and `asset_run_bg` call appends one line to `<assetDir>/usage.jsonl`, the call log the library's hit-rate and activity statistics are computed from.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin to let agents discover, inspect, and re-run archived research assets. It requires `ctx.tools` and `ctx.subprocess`; `asset_run` additionally consults `ctx.approval` (opportunistically — with no approval service composed it fails closed), and `asset_run_bg` reports an accepted run to `ctx.roundtable` when that service is composed (opportunistically — without it the tool still submits the run and its record stays on disk).

### When to choose it

Use it in FinDeck compositions, where sessions train models or write reusable computation and later sessions should reuse them. Without it, the asset library still works through the Python `findeck.assets` module, but no tools or catalog expose it to the model.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-tool-asset-library'
```

| Field | Default | Meaning |
|---|---|---|
| `assetDir` | `<harness home>/asset-library` | Asset library root, resolved from the configured home, `$DSH_HOME`, else `~/.findeck`; mirrors `FINDECK_ASSET_DIR` on the Python side |
| `pythonPath` | the repository's `finance/python/.venv` interpreter | Finance venv used by `asset_run` and `asset_run_bg` |
| `requireApproval` | `true` | Whether `asset_run` must pass the approval seam before executing; `asset_run_bg` never asks, because it only submits detached work and answers before any result exists |
| `background` | `true` | Whether this composition registers `asset_run_bg`; the unattended desk composition sets `false` |
| `sandbox` | `false` | Whether `asset_run`/`asset_run_bg` must execute through `ctx.sandbox` with the asset library as the only writable root. The desk composition sets `true`; a missing sandbox service fails closed instead of running unconfined |
| `maxOutputBytes` | `262144` | Per-stream collected output cap for one `asset_run` / `asset_run_bg` call |
| `graceMs` | `15000` | Termination grace for `asset_run` / `asset_run_bg` child processes |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-asset-library) is the exhaustive source for every accepted field.

### What the model gets

- **A session asset catalog.** When assets exist and the `asset_list` tool is visible, the agent receives a durable user-role message listing each asset's name, kind, latest version, and description, with pointers to the three inspection tools.
- **Discovery and inspection tools.** `asset_list` returns every asset's summary including validation metrics and dependencies, optionally filtered by `query`/`kind`; `asset_search` returns the summaries and version-directory paths of the assets matching any AND-combination of `query`, `kind`, `origin`, `tag`, `verb`, and `depends_on`; `asset_show` returns one version's manifest, file list, and Python code preview; `asset_graph` walks the dependency graph — the transitive closure forward (missing names flagged) and every reverse dependent — following each dependency at its latest version; `asset_dir` reports the library root.
- **In-venv execution.** `asset_run` resolves the version directory, passes the approval seam, and runs the asset's entry function through the subprocess Service Definition inside the finance venv, returning collected stdout plus the driver's result payload.
- **Background submission.** `asset_run_bg` resolves the asset's latest version, starts `findeck.verb_bridge --background` detached in the finance venv, and returns `{ run_id, record_path, asset, verb, status: 'running' }` as soon as the bridge accepted the request — the verb itself keeps running and writes its result to `<assetDir>/runs/<run_id>.json`. It takes no approval seam, and when the roundtable engine is composed it registers the run so the submitting speaker is handed the result at a turn boundary.

### Observable success and failures

A successful `asset_run` returns `{ stdout, result_json }`. An unknown asset or version names the available ones; a missing venv points at the setup script; a declared dependency absent from the venv is reported as a list to install and is never auto-installed; a missing approval service or a user rejection refuses execution. All failures carry `Error: <message>`.

A successful `asset_run_bg` returns the run's id and record path while the run is still executing. It refuses before spawning when the library index is unreadable or the asset name is unknown, and reports the bridge's message when the submission itself fails; a failure inside the detached run is not visible here — it lands in the run record as `status: 'error'`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the tools and the catalog are built; the observable behavior is fully covered in [Use this package](#use-this-package) and the Model Experience section below.

### Design concept

The Python module owns the library format; this package owns the model boundary. The bridge is `index.json`, rebuilt on every archive, defensively parsed as a durable file boundary — an unreadable index reports as an absent library rather than a different one, an unsupported index version voids the file, and a version-2 field present with the wrong type voids it too. Version 1 stays readable: its entries parse with `origin` and `face` unset, `verbs`/`tags` empty, and `freshness`/`lineage` null. The catalog drives `publishSessionCatalog` from `@deepseek-ai/dsh-skill`, the publication decision the skill catalog shares: digest over durable entries, exact-tool visibility, complete replacement messages.

### Call log

Every successful `asset_search`, `asset_show`, `asset_run`, and `asset_run_bg` appends one JSON line to `<assetDir>/usage.jsonl`: `{ts, tool, asset?, session?}`, where `asset` is absent for a library-wide search and `session` is absent when the call has no owning agent. The file is created (with its directory) on the first recorded call. Recording is a side channel — a library directory that cannot be created or written to leaves the statistics stale and never fails the tool call.

When the desk runner sets `FINDECK_DESK_SOURCES_FILE`, a successful `asset_show` or `asset_run` also appends one line to that run's source ledger with the exact resolved version. The report archive merges that ledger with the signal inputs; a failed read or run records nothing. Ledger writes are **not** a silent side channel: a report that cannot record a version would omit a source it used, so the tool fails instead.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: seven tool registrations, catalog pre-step listener, usage log, driver protocol, background submission |
| [`src/types.ts`](src/types.ts) | Index/source shapes and the `asset-library-catalog` message-source merge |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream; execution relations are owned by the subprocess, approval, and roundtable seams it calls. |

### Driver protocol

`asset_run` spawns `<venv-python> -c <driver> <version-dir> <entry> <args-json>` with the version directory as cwd and collected stdout/stderr. The in-venv driver loads `manifest.yaml`, refuses with a missing-dependency list when a declared package is absent from the venv, imports the asset's `.py` files, calls the entry with the decoded keyword arguments, and prints the JSON result after a marker line; exit codes `3`/`4` distinguish missing dependencies from driver errors.

`asset_run_bg` spawns `<venv-python> -m findeck.verb_bridge --background <request-json>` with the asset's version directory as cwd. The bridge starts the detached run, prints one JSON line naming the accepted run, and exits; the tool reads the run id from that line, computes the record path as `<assetDir>/runs/<run_id>.json`, and hands the run to the roundtable engine when one is composed.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-asset-library) — the exact schemas the model receives.
- [`finance/python/findeck/assets.py`](../../../finance/python/findeck/assets.py) — the library layout, manifest contract, and archive validation this package consumes.
- [tool-skill package](../tool-skill/README.md) — the session-catalog lifecycle this package's catalog mirrors.

-----

<a id="model-experience"></a>
## Model Experience

### Session asset catalog

#### What the model sees

When assets exist and this exact `asset_list` tool is visible, the agent receives the catalog template below as a durable user-role message before the first request. Library changes append a complete replacement with the same `<available_assets>` envelope.

##### Asset catalog template

```markdown
<system-reminder>
Reusable research assets from this user's FinDeck asset library are available:

<available_assets>
- `<name>` (<kind> v<version>): <normalized-and-capped-description>
</available_assets>

Call `asset_list` for validation metrics and dependencies, `asset_show` to inspect an asset's manifest and code, and `asset_run` to execute an asset entry in the finance Python environment. Assets are versioned; calls default to the latest version.
</system-reminder>
```

#### Token effect

Cost scales with asset count and the capped description (240 characters); nothing is sent while the library is empty or absent.

#### KV Cache effect

The durable catalog is appended after the reusable prefix; replacements are append-only history after it, so earlier reusable tokens stay intact.

### Tool schemas

#### What the model sees

The model sees the generated [`asset_dir` / `asset_list` / `asset_search` / `asset_show` / `asset_graph` / `asset_run` / `asset_run_bg` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-asset-library).

#### Token effect

Fixed schema cost per request where the tools are visible.

#### KV Cache effect

Prefix-stable while the tool definitions and visibility are unchanged.

### Tool results and errors

#### What the model sees

`asset_run` success renders `asset_run <name> → <result payload>`; failures render `asset_run <name> failed: <error>`. `asset_run_bg` success renders the run id and its record path. Other tools render their summaries and manifests as text.

#### Token effect

Data-dependent tool-result tokens, resent on later steps until compaction; `code_preview` is capped at two files × 1200 bytes.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tools are a poor fit. They are current package constraints, not a task backlog.

- **Entry discovery imports every top-level `.py` file** — an asset whose module-level code has side effects executes them before the entry resolves; assets own that behavior.
- **No streaming or partial results** — `asset_run` is batch: collected output is capped and spilled tails are not linked into the tool result.
- **The catalog is whole-list replacement** — one archived or removed asset republishes every entry; the digest keeps unchanged libraries free.
- **Model assets must ship a runnable `.py` exposing `predict`** — weights alone are not executable; the archive discipline in the research skill owns that contract.
- **Sandbox `workspace-write` governs file effects only** — the desk composition roots it at the asset library, so a verb cannot write the repository, desk tasks, or the user's home, but the sandbox provider does not add an executable allowlist; an asset's Python code can still start a program that does not write outside the granted roots. Treat archived asset code as trusted input.
- **Source recording covers tool reads, not internal asset code** — `asset_show` and `asset_run` report the version they resolved; a version another asset reads internally is not visible and is not guessed.
- **`asset_run_bg` reports no completion** — it answers with the accepted run's id and record path, never with a result; the caller that wants the result back must compose the roundtable engine (which follows the record to a turn boundary) or read `<assetDir>/runs/<run_id>.json` itself. The record path is computed from this package's `assetDir`, and every finance-venv spawn sets `FINDECK_ASSET_DIR` to that same absolute root, overriding an ambient value. Its absent approval seam is deliberate: the tool only submits detached work and no result exists at call time, so what it may run is bounded by the asset verbs the library exposes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
