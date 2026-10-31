---
description: "Shared Workspace browser and picker plugin for the dsh web client: grouped or flat session rows, add/rename/reorder, search, fork, archive with restore, and the directory-flow picking hole."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-workspace` is the shared Workspace browser and picker of the dsh web client: users browse grouped or flat Session rows in the sidebar, pick a Workspace for a new session from the Session Intent hero, and manage Workspaces and Sessions with add, rename, reorder, search, fork, archive, and restore actions; the sidebar adds a project through a name-first dialog, the hero keeps the Workspace menu, and one directory-flow child hole serves both. The archived Sessions every grouping surface hides collect in one folded group under the last project group, so archiving is reversible from the browser itself. Pending user interactions surface as amber warning dots, active Schedule projections surface as non-interactive alarm markers in ordinary and search rows, and the shared sidebar projection hides subagent-origin sessions. Distinct canonical paths remain separate id-keyed Workspaces, and each project group header shows its working directory abbreviated beside the project name.

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

Use the sidebar to browse Workspaces and their Sessions, reorder them, and start new ones; use the picker in the Session Intent hero to choose a Workspace for a new session. An open Workspace shows five non-blank Sessions by default and keeps the selected blank **New Session** as one provisional extra row until its first prompt. **Show more** reveals the hidden remainder; closing and reopening the Workspace restores this folded projection.

### Creating a project

The sidebar header's add button opens **New project**: the name is the required field, and the working directory is an advanced option. Submitting a name alone lets the Host derive and create `<home>/projects/<uuid>` as the project's working directory; revealing the advanced option opens this surface's directory-flow hole, whose picked folder becomes the working directory instead. The new group appears through the Workspace state stream, and the header shows the name with the abbreviated working directory beside it.

### Changing a project's directory

Every project row's overflow menu carries **Change working directory** beside Rename and Delete. It opens the same browser-owned dialog family as Rename, prefilled with the project's resolved project directory, and writes through `workspaces.setProjectDir`: the Host is the authority on whether the typed directory is usable (it must be fully qualified, and it is created when missing), so a rejection's own message renders under the field. **Restore default folder** clears the override through `workspaces.resetProjectDir`, returning the project to its derived `<home>/projects/<workspaceId>`. The row's abbreviated path cell shows the project directory once one is set — the directory this menu changes — and the working directory the project runs in until then; the unary echo and the Workspace follow stream update the same projection, so the cell never keeps the previous path.

### Reordering and view options

View options combine grouping with one browser-persisted Session order per account: **Manual** and **Last updated** apply in either presentation. Entering Last updated performs a complete recency sort and later user prompts or steers promote their Session once; entering Manual preserves every current position and disables later promotion. Dragging edits the current order in either mode; Manual-mode drags for real Workspaces also update the Host Session account, while Uncategorized and flat-list orders remain browser-local. In a collapsed group, drag boundaries follow rendered rows and place the source before intervening hidden rows, so a drag cannot hide its source. Workspace drag order is Host-durable in either Session order mode.

### Search

Collapsed search is one header action beside the view and add actions: activating it expands the field across the header. A non-blank query replaces either browsing mode with one flat result list — case-insensitive title and Workspace substring matches appear immediately, while a 250 ms debounced Host request adds ranked current-conversation content matches and snippets. Each new query aborts the preceding request; a failed content search leaves metadata matches visible with a warning. The list is capped at 20. Choosing a result clears and collapses search, opens the Session, and scrolls its row into view in the configured browsing mode; grouped browsing also expands its Workspace and the full Session list when required.

### Managing sessions

The Session row's Rename action opens a dialog prefilled with the row's display title; confirming an unchanged title is deliberately allowed — it pins the current automatic title against regeneration. Archive commits without a confirmation dialog and the row disappears from every grouping surface when the archive-set echo lands, into the archive group that closes the list; that group's rows carry Restore in place of Archive, and restoring a row returns it to the position its accounting slot held. Fork forks at the source's last completed turn, increments the inherited persisted title on the client, and then opens the child. Workspace Delete opens a confirmation that states the retention boundary; success removes the group while its Sessions remain under Uncategorized.

### Pending interactions

Session rows render the runtime's live `pendingInteraction` classification: approvals report **Waiting for approval**, plan reviews report **Plan awaiting review**, and ordinary questions report **Waiting for answer**. Every pending interaction uses an amber warning dot that takes precedence over the running indicator.

### Active Schedule markers

Grouped and flat Session rows, plus search results, show an outline alarm when `SessionSummary.projectionValues.schedule` is a non-empty array. The marker sits after the title; an ordinary row keeps its update time after the marker, while a search result has no update time. It is not a button, has no independent pointer action or tab stop, and clicking its area still opens the row. The localized tooltip and matching screen-reader label say **Has an active session reminder**.

The value is intentionally best effort for cold Sessions. An identity-matching usable projection-cache row can prewarm the alarm without opening the Session; a missing or stale cache may briefly omit or retain it. The marker means only that the current list value contains an undispatched or undeleted Schedule record. It does not report whether a Schedule runtime is live or able to wake the Session.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is one composition: both target slots are declared by other plugins, so `apply` uses `slots.inject()` to register for each declaration lifetime and re-register after a declaring slot is restored.

### The directory-flow hole

Each registration declares a **directory-flow child hole** (`single` kind: `conversation.hero.workspace.directoryFlow` / `sidebar.workspaces.directoryFlow`) that the composed picker package's client half fills with its picking interaction — the `-native` backend's renderless OS-chooser driver, an in-app browsing dialog under a `-browse` composition. The sidebar's new-project dialog raises it only from the optional custom-working-directory disclosure, so a name-only project is creatable in a composition with no picking backend and the disclosure is absent there rather than dead; the hero's **Add workspace...** menu entry still renders only while its hole is occupied. This package owns the trigger and the adoption: the occupant reports one picked path per open through the hole's owner conversation (`open`/`busy`/`onPicked`/`onCancel`/`onError`), and the sidebar takes that path as the created project's working directory while the hero adopts it as a Workspace through the object layer, selecting the committed Workspace only after its list projection has refreshed.

### View state

Once the Workspace list baseline is ready, browser-persisted expansion and Session-order records retain only current Workspace ids plus Uncategorized and the flat-list account. Real Workspaces initialize from `WorkspaceView.sessionIds`, while Uncategorized and the cross-Workspace flat list initialize from recency. The shared sidebar projection hides rows whose durable Session summary has `origin: 'subagent'`, and each visible ordinary row inherits the blue activity indicator while any descendant reached through uninterrupted subagent-origin lineage is running. The same pure derivation reads the Schedule key from list projection values for grouped, flat, and search nodes; the package uses only the type-only `@deepseek-ai/dsh-schedule/client` dependency and does not import the Schedule runtime or `ui-schedule`.

### Hover cards

Workspace and Session hover cards copy the value their row clips: activating a Workspace card writes its full directory path, while activating a non-blank Session card writes its full display title. A provisional blank New Session card remains read-only because its localized label is a placeholder rather than session content.

### Session navigation

`ctx.uiWorkspace.openSession(target)` holds the target as the main view's own retained reference and then writes the Controller's selection, so `SessionListState.current` and its persisted `dsh.sessions.current` key keep exactly one owner. The new occupant is retained before the previous reference is released, so switching never leaves the main view at zero references in between. A bare identity goes through `sessions.open` and a subagent address through `sessions.openSubagent`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the sidebar host, the hero surface, and the picking backends.

- [ui-sidebar](../ui-sidebar/README.md) — the sidebar shell hosting the `sidebar.workspaces` hole.
- [ui-conversation](../ui-conversation/README.md) — the chat surface hosting the Session Intent hero's picker hole.
- [directory-picker-native](../../host/directory-picker-native/README.md) — the OS-chooser backend filling the directory-flow hole.
- [Workspace Controller](../../api/workspace-controller/README.md) — the Host mutations and framework-neutral Client projection that own workspaces and ordering.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the search depth, the archive surface, and the picking carrier; they are current package constraints.

- **No fuzzy content search or event deep links** — the content backend uses literal token/phrase matching, and selecting a result opens the Session rather than the matching event.
- **No Session deletion control** — sessions can be archived and restored, but the browser holds no delete verb: the Host discards an archived Session's log only when the archive retention window expires, and Workspace registration deletion does not delete Sessions.
- **Pending user interaction is not aggregated into collapsed groups** — a waiting row inside a collapsed group lights no group-header indicator and becomes visible only after that group is expanded.
- **Native folder selection depends on the local Host carrier** — under the `-native` composition, in-process or remote browser deployments cannot open a local operating-system dialog; remote-capable picking is the `-browse` composition's in-app flow.
- **An existing Session cannot move between projects** — Session membership is decided by the immutable header `cwd` recorded at creation, so a Session belongs to the project whose working directory created it. Moving one would require relocating committed Session logs, which the released-session discipline forbids.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A pure-consumer plugin registering presentational components into two host-declared slots plus its locale dictionaries — its inject face is stateless RPC wrappers plus a create-and-open call; it emits no cordis events and owns no cross-plugin mutable state.
