---
description: "The FinDeck asset hub: one settings section over the assetOverview Remote — the asset grid and list over assetLibrary, the face detail view that renders every face.json block type through runVerb, the lineage graph, and the reports and mode-flow tabs."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-assets

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-assets` is the asset hub: one `settings.section` row (`research-assets`, first in the sidebar's direct nav) that shows the asset library the way a user reads it, beside the files the AI reads. Five tabs — the asset **grid/list** over the v2 `assetLibrary()` snapshot, the **reports** with the thesis strip, the **mode flows** with per-step models, the **Work modes** created from selected assets, and the **lineage graph** — plus one **face detail view** that renders an asset version's `face.json` block by block and runs its verbs through the `runVerb` bridge. The host owns every read, every verb run, the workbench definition write, and the session an entry opens; this package renders what the Remote answered.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row in a web profile after `ui-shell` and the API Remotes it reads. It requires `ctx.slots`, `ctx.locale`, `ctx.sessions`, and the mounted `assetOverview` / `agentPresets` Remote faces.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-client-ui-assets'
```

No configuration. The section id is `research-assets`, and it renders as a full page through the shell's `shell.page` hole.

### What the page shows

- **Assets** — one card per v2 library entry (name, kind badge, origin, latest version, freshness `as_of`, tags; a stale entry is dimmed), or the same library as a compact table. Filters cover kind, origin, tag, and a substring over name/description/tags/verbs; the table sorts by name or by `as_of`. Clicking a card or a row opens that asset's face.
- **Face detail** — the asset version's manifest facts (as-of, validation, created, source session, interface, verbs, tags, upstream inputs, version directory), a **Hand to AI** button, and the face itself: the eight v1 block types (`metric-card`, `line-chart`, `data-table`, `log-view`, `status-badge`, `action-button`, `param-form`, `embed`) rendered with one design language. A dataset that declares no face renders the built-in default face (as-of, row count, preview table); any other asset without a face shows the no-face placeholder with the hint to generate one.
- **Lineage** — the asset snapshot projected into a directed, layered SVG: columns are dependency depth, arrows point from an upstream asset at its consumer, and a click opens that asset's face.
- **Reports** — every report the registry knows (title, workspace, modified time) followed by the thesis strip: each conclusion with its status, check count, and the registry hit/miss score.
- **Mode flows** — presets grouped into work flows (declared steps, each with its model route) and free/lightweight ones; the form below copies an existing work preset under a new id and name and replaces its flow.
- **Work modes** — the shipped and user `workbench.yaml` definitions with their asset sets; **Open session** creates a session on the host-generated workbench brief. **Select assets** enters multi-select on the assets tab; the selection bar writes one user Work mode definition (validated by the repository's Python validator, never overwriting an existing one) and opens its brief in a new session.

### Observable success and failures

The page loads the library and the overview snapshot together and reports a failure per tab that needs the missing one, each with its own retry button; a partial library read the host reports as `problems` renders above the tabs. Inside a face, every data block carries its own loading and error line, a triggered verb reports its duration and output (or the bridge's error message), and a `face.json` whose blocks do not match spec v1 renders the readable blocks plus a count of the skipped ones. The flow form reports its failure inline and reloads the snapshot after a successful create.

### Handing an asset to the AI

**Hand to AI** asks the host for the asset's seed text (`assetBrief`), creates a session (`ctx.sessions.create`), opens it, registers a submission echo, and sends the seed as that session's first prompt. Opening the session also leaves this page: the shell returns the main area to the conversation whenever the current session changes, and the page additionally closes its own section once the prompt is accepted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`AssetsPage` holds the tab, the view mode, the filter, the ordering, the selected asset, and one load state for the two snapshots; every child is a pure renderer over those values and the injected adapters. `src/client/index.ts` registers the `ui.assets` dictionary and the section row, and adapts the Remote results: reads throw with the Remote's message, a failed transport for `runVerb` is folded into the protocol's own `error` branch so the renderer keeps reading `status` as the only verdict.

Data blocks do not fetch on their own: `FaceRenderer` collects the face's distinct `asset` + `verb` + `params` requests, issues each one once, and every block reads its own entry — so two cards over the same `preview` call cost one bridge call, and a failed block does not take its siblings down.

### Source map

- `src/client/index.ts` — dictionary registration, the `research-assets` section row, the retained `assets/open` / `assets/open-thesis` requests, and the Remote adapters (`assetLibrary`, `overview`, `assetFace`, `runVerb`, `assetFile`, `assetBrief` + sessions, `savePreset`, `workbenches`, `createWork`, `workbenchBrief`).
- `src/client/AssetsPage.tsx` — the page: tabs, snapshot load state, filter/sort/selection/multi-select state, the external-open route, and the Work create/launch surfaces.
- `src/client/assets/library.ts` — pure projections: filtering, ordering, lineage edges (`depends_on` ∪ `lineage.inputs`, self-loops dropped), and the layered layout.
- `src/client/assets/labels.ts` — the manifest `kind`/`origin` vocabulary mapped onto dictionary keys.
- `src/client/assets/AssetsView.tsx` — the toolbar, the card wall, and the compact table.
- `src/client/assets/AssetDetail.tsx` — the face detail view, its manifest facts, and the hand-off entry.
- `src/client/assets/LineageGraph.tsx` — the lineage SVG.
- `src/client/face/spec.ts` — pure face reading: block parsing, the `extract` dot path, scalar/row/chart/table/text projections, and request dedupe.
- `src/client/face/FaceRenderer.tsx` — the eight block renderers, the shared data-request registry, and the default dataset face.
- `src/client/reports/ReportsTab.tsx`, `src/client/flows/FlowsTab.tsx` — the two tabs carried over from the previous page.
- `src/client/locales.ts` — the `ui.assets` dictionary keys.

-----

<a id="model-experience"></a>
## Model Experience

None from rendering: the page reads Remote snapshots and runs verbs the assets themselves declare. The one path that reaches a model is the hand-off entry, which sends the host-generated seed text (`assetBrief`: asset name, version, version directory, manifest summary, lineage, verbs) as an ordinary user prompt into a new session; the seed is the session's first durable message and nothing else is injected.

#### KV Cache effect

None on its own. The prompt the hand-off sends is a new session's first request, so it builds that session's prefix rather than extending an existing one.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Hit rate and live rate are seats, not columns** — the list view renders both headings with an empty cell; P4 owns the `usage.jsonl` data behind them.
- **One snapshot per visit** — the page loads the library and the overview once and offers retries on failure; it does not refresh on its own, so versions another session archived appear after the next visit.
- **The lineage graph is a static layered layout** — columns follow dependency depth in the snapshot's order, so a large library reads as a wide picture with no pan, zoom, or edge routing around nodes.
- **A face that is not spec v1 degrades silently** — an unreadable block type is skipped and counted rather than refusing the whole face; the generation-time validator is the gate that keeps faces conforming.
- **The embedded document runs with scripts** — `embed` renders the asset's own html in an `iframe sandbox="allow-scripts"`: the document gets an opaque origin and can reach neither this page nor the library, but interactive exports (notebook dumps, self-contained reports) are expected to need scripts. Tightening this to a script-free sandbox is a one-attribute change.
- **Report bodies are not rendered** — the reports tab lists metadata and scores; reading a report itself stays with the session that wrote it or the file on disk.
- **The flow form only copies** — a new flow starts from an existing work preset; there is no authoring surface for a brand-new composition.
- **Work creation needs the finance venv** — the host validates a new `workbench.yaml` with `python -m findeck.workbench validate`; without the venv the create entry reports the validator failure instead of writing an unvalidated definition.
- **Work definitions are user-owned** — the create entry writes `<harness home>/workbenches/<name>.yaml` and refuses an existing name; editing or deleting a definition stays on disk.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The page replaced the ui-pages `research-assets` placeholder, and the assets tab replaced the old `overview().assets` card list with the v2 `assetLibrary()` snapshot (the old fields lack origin/verbs/freshness/tags/stale, so they were not reusable). The lineage graph is a pure client projection of that same snapshot — no graph Remote — per the plan's R9 revision; it reads `depends_on` because the snapshot carries no `lineage`, and `archive()` keeps `depends_on` and `lineage.inputs` equal (it backfills one from the other and refuses a mismatch), so the union is already the snapshot's own declaration. The graph layout reuses the column-by-depth idea of the dependency graph it replaced, and ignores self-edges (the incremental-refresh shape).

</details>
