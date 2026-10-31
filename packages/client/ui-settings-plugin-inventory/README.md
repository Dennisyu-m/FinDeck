---
description: "Plugins page body for the dsh web client: switchable user-managed plugin cards over a collapsed system-plugin region holding the configuration views and the read-only inventory."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-plugin-inventory` contributes the body of the Web Settings **Plugins** page. On mount it calls `ctx.remote.pluginInventory.list()` once and renders two regions. The user region lists the curated catalog's optional, user-facing plugins as cards — name, one-line description, and a switch that writes the entry's `disabled` fact into the user patch layer (`$DSH_HOME/cordis.patch.yml`); the off direction asks once, because disabling silently removes what the plugin provides. The system region is a disclosure closed by default: its header carries the system plugin count, and expanding it stacks the configuration views contributed to `settings.plugins.system` above the read-only inventory. That inventory keeps its two collapsible groups: the agent-preset group comes first, open by default, with a display-only switcher pill over the roster and one compact disclosure card per composition row carrying its enablement — including `conditional` for a disabled gate the Host could not evaluate — and provenance facts behind the disclosure. The global group follows, its header carrying the filtered entry count and a failure count; expanded, failures float first, and an entry disabled globally but enabled by at least one preset is marked as preset-provided in place — its details name the enabling presets — instead of reading as plainly disabled. Search filters the system inventory, forces the collapsed groups open, and points at matches sitting in unselected presets. Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details; without a roster the body renders the global plane alone. Every global row the user region does not own also carries the same switch.

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

Open the Plugins section in Settings. The user region is at the top; expanding **System plugins** below it reveals the configuration views and the Host's plugin inventory. The body reads no Remote during plugin activation — mounting the page calls `ctx.remote.pluginInventory.list()` and `ctx.remote.pluginPatch.read()` through `api-remotes`.

### The user-managed cards

A card appears when the Loader entry's module matches a catalog row flagged `managed`. The flag marks optional, user-facing capability: the harness boots and serves without the plugin, disabling it degrades only the feature it provides, and the same card reverses the decision. Transport, session, settings, sandbox, prompt, and shell plugins are load-bearing and stay in the system region, where the same switch is available but the card sits with the reference inventory.

Switching writes one `disabled` fact for the Loader entry id into the user patch layer. The caller may pass the patch id or the Loader's prefixed entry id; the file stores the patch id. `pluginPatch.write` also accepts a list of `{ id, disabled }` and applies that list in one file replacement, so a live reload runs once; an id that is not in the current Loader rejects the whole list and leaves the file unchanged. The user layer is applied after every bundle layer; profiles declared `patchReload: live` (the shipped Web profile) reconcile the tree on the write, so the switch takes effect without a restart. Disabling asks for confirmation first because it silently removes what the plugin provides; enabling is one click. A write failure leaves the switches on their runtime state and reports the failure above the region, and a patch read failure disables nothing but charges the next write attempt.

### Reading a card

Each collapsed card uses the short module name as its title and a small enablement tag; enabled entries also show a colored root-fiber status dot. Expanding one card reveals the declared entry id, the full module specifier, and the state facts: a preset row names the preset it comes from, its runtime status when the composition is live, and its disable condition when it carries one; a preset-provided global row explains that agent presets provide it per session, names the presets that enable it, and offers a jump into the preset group. Preset names resolve through the shared `presetDisplayText` fold (`dsh-agent-presets/display`) over [`ui-agent-preset`](../ui-agent-preset/README.md)'s dictionaries: shipped presets follow the active locale while user-authored ones keep their own metadata, so an English surface never echoes the preset files' Chinese names. Search filters the system inventory by module name and entry id.

### The preset switcher

The switcher is the same selector-pill-plus-menu control the General settings rows use. It lists every roster preset — the default suffixed as such, broken ones marked — and changes only what the list shows: it writes no settings, and selecting a broken preset shows the discovery-reported reason in place of rows. Choosing the default preset or a session's preset stays where it was: the Agent presets section and the new-session screen.

### Retrying a failed read

A failed read renders a generic failure state inside the tab; retrying re-runs the lazy `list()` call without exposing transport details.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page body is a Host-owned snapshot projection plus one write path; it performs no Remote read during plugin activation and takes the snapshot on mount.

### Registration

The browser plugin registers one localized `settings.plugins.body` contribution with id `plugins-body` and declares `settings.plugins.system` as its child — the seat the configuration views stack inside its collapsed system region. The Plugins section owns the navigation entry and page chrome. Registration uses `ctx.slots.inject()`, so it follows late declaration, redeclaration, locale changes, and teardown without importing the section owner.

### Rendering

Row keys are scope-qualified (`user:`, `global:`, `preset:<id>:<index>`), so one module appearing in both scopes keeps distinct disclosure state; an entry id is shown as detail only when the row declares one and is never classified by string shape. The managed entry set is a client-side split of the Loader inventory by catalog flag, not a Host classification: the user region holds the managed rows, the system region every other row. The preset-provided marking is derived client-side: a global entry carries it when it is disabled there while at least one preset row for the same module specifier is actually enabled, so a module every preset gates off (or declares only conditionally) stays plainly disabled rather than over-claiming provision.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings section, the remote calls, and the Host-side projection.

- [ui-settings-plugins](../ui-settings-plugins/README.md) — the Plugins section whose page body this package fills, and the configuration view it stacks.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.plugins.body` and `settings.plugins.system`.
- [api-remotes](../../api/remotes/README.md) — the Remote BFF surface behind `pluginInventory.list()` and `pluginPatch.read()`/`write()`.
- [plugin-inventory](../../host/plugin-inventory/README.md) — the Host-side read-only Loader projection this page renders.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side plugin page body that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the freshness, the reach, and the persistence of the page; they are current package constraints.

- **One snapshot per Settings mount or retry** — the page does not subscribe to Loader changes or automatically refetch after reconnect; reopening Settings obtains a new snapshot.
- **The user/system split is a client-side catalog flag** — the Host inventory carries no user/system classification, so `catalog.ts` owns the curated `managed` rows; a module absent from the catalog never appears in the user region.
- **The patch write is durable, not transactional with the tree** — the toggle writes the user layer and reports success from the write alone. A profile declared `patchReload: startup` applies the change only at the next start, and the copy claims immediate application; the shipped Web profile is `live`.
- **Preset-owned rows are not user-switchable** — a row a preset provides carries no switch, because the preset composition, not the user layer, is where its enablement lives.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns a read-only Settings contribution.
