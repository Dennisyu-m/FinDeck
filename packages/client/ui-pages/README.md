---
description: "The session-reminders page, the environment-and-components page, and the Help page of the FinDeck information architecture."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pages

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-pages` holds three first-class navigation entries of the FinDeck information architecture. Session reminders renders every stored session's reminders as a card wall grouped by reminder type — read off the [R11] binding header the reminder prompt carries — with a per-card pause/resume switch and direct deletion backed by the `scheduleControl` Remote, one status chip (paused / session closed / overdue / scheduled), and the copyable reminder templates behind the create button. Environment & components is the component download grid over the `componentCatalog` Remote: six installable runtime components, each row carrying its downloaded badge with version, estimated size, install location, prerequisites, and a download action, with the one running install job rendered as a live byte progress bar plus cancel. Help renders the quick-start path (connect a model, set up the data environment, ask a finance question), the modes-and-flows explainer, and the feature map that names each shipped capability with its entry point. Every page registers one `settings.section` row — id, order, localized label — so the sidebar page navigation picks it up with no shell change.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package to give the sidebar navigation its FinDeck entries. It requires `ctx.slots`, `ctx.locale`, and the mounted `scheduleOverview` / `scheduleControl` / `componentCatalog` Remote faces; every page lands through the settings section contract.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-client-ui-pages'
```

No configuration: page copy lives in the `ui.pages` dictionary namespace (zh is the key-set source of truth; en must match it exactly).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`SchedulePage` owns one load state machine (`loading` / `error` / `ready`) over its injected `load` callback, renders the answer it gets back, and re-runs the callback when the retry button is clicked. `SchedulePage` additionally groups the loaded runs by category, shows one card per run, and drives its injected `control` callback for pause and resume and its injected `remove` callback for deletion: the card stays on the state the Remote last reported until the request answers, then a silent refetch swaps in fresh data. Each card's overflow menu copies the task prompt and deletes the task directly through the `scheduleControl` Remote, with no confirmation step. `DataEnvPage` renders the component grid, whose state lives in `src/client/componentCatalog.ts`: the apply closure subscribes once to the `componentCatalog.follow` stream through `ctx.remote.$stream`, folds `progress` / `installed` / `failed` events into a plugin-level snapshot store, re-reads the catalog after every outcome, and hands the page that store through the registration's `hooks` compartment — so the component only reads a bound hook (`useCatalog`) and calls the injected `reload` / `install` / `cancel` actions. The Host runs one install job at a time, and the page mirrors that by disabling every other row's download button while a job is tracked. `HelpPage` renders the quick-start steps, the modes-and-flows explainer, and the feature map from the `ui.pages` dictionary. `src/client/index.ts` registers the dictionary and the three section rows.

-----

<a id="model-experience"></a>
## Model Experience

None, as the pages only present host-supplied data; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Help is text only** — the page carries the quick-start steps, the modes-and-flows explainer, and the feature map; there is no illustrated tour and no in-page documentation browser.
- **A running install has no resume point** — the components block tracks the single job through the `componentCatalog.follow` stream, so a dropped stream clears the progress row and the next catalog read restores only the installed state, not the bytes already moved.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
