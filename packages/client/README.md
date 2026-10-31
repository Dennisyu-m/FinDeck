---
description: "Package map for the web GUI browser half: shell boot, browser-host communication, shared client services, localization, development reload, and the UI feature plugins."
kind: "package-group"
---

# client/ — web-GUI browser half

English | [中文](README.zh.md)

## Summary

The `client/` group runs the browser half of the dsh web GUI: it boots the web shell, loads browser-side plugin modules, keeps browser-to-host RPC and event delivery alive, and provides the shared client services and UI feature plugins that render the application. UI features compose through the slot system — each plugin fills declared extension slots with typed props and stores, and the shell renders the assembled tree. All packages here are product packages named `@deepseek-ai/dsh-client-<name>`; the host half that serves the page lives in [`host/`](../host/README.md). Authoring rules live in [AGENTS.md](AGENTS.md), and the module graph, slot model, and object layer are documented in the related notes below.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The kernel packages boot and serve the page; the UI feature packages present it. Each package README owns its contract and configuration.

| Package | Role | ctx key |
|---|---|---|
| [`web/`](web/README.md) | Boots the browser shell | — |
| [`modules/`](modules/README.md) | Loads browser-side client modules | `ctx.clientModules` / `ctx.modules` |
| [`connection/`](connection/README.md) | Maintains browser-host RPC communication and event delivery | `ctx.connection` |
| [`file-upload/`](file-upload/README.md) | Sends raw Blob and byte-stream request bodies outside the page thread | `ctx.fileUpload` |
| [`store/`](store/README.md) | Provides React-free observable and snapshot-store primitives | — |
| [`hmr/`](hmr/README.md) | Refreshes client plugins during development | — |
| [`locale/`](locale/README.md) | Provides localization preferences and message dictionaries | `ctx.locale` |
| [`resources/`](resources/README.md) | Resolves `dsh-resource://` addresses into live values that components read through `useResource` | `ctx.resources` |
| [`test-runtime/`](../test-support/client-runtime/README.md) | Shared repository test support for client feature packages | — |
| [`ui-renderer/`](ui-renderer/README.md) | Binds slot data to React and mounts the assembled application | `ctx.uiRenderer` |
| [`ui-slots/`](ui-slots/README.md) | Defines how UI features register and compose extension slots | — |
| [`ui-shell/`](ui-shell/README.md) | Contributes the FinDeck root shell frame, its page and column holes, and the `ctx.layout` service face | `ctx.layout` |
| [`ui-session/`](ui-session/README.md) | Adapts Session Controller state into standard Slot sources and hooks | — |
| [`ui-theme/`](ui-theme/README.md) | Applies the selected color theme | — |
| [`ui-primitives/`](ui-primitives/README.md) | Provides shared React controls, icons, and content renderers | — |
| [`ui-attachment/`](ui-attachment/README.md) | Registers composer and message-image attachment presentation | — |
| [`ui-layout/`](ui-layout/README.md) | Arranges the main application regions | — |
| [`ui-sidebar/`](ui-sidebar/README.md) | Presents workspace and session navigation | — |
| [`ui-dockkit/`](ui-dockkit/README.md) | Provides the split-tree docking layout kit the right Sidebar embeds | — |
| [`ui-sidebar-right/`](ui-sidebar-right/README.md) | Owns the right Sidebar's docking surface, tab-type registry, and navigation controller | `ctx.sidebarRight` / `ctx.sidebarRightTabs` |
| [`ui-sidebar-files/`](ui-sidebar-files/README.md) | Registers the right Sidebar's workspace file-navigator tab type | — |
| [`ui-sidebar-terminal/`](ui-sidebar-terminal/README.md) | Registers the right Sidebar's interactive terminal tab type | — |
| [`ui-workspace/`](ui-workspace/README.md) | Provides workspace selection and creation surfaces | — |
| [`ui-conversation/`](ui-conversation/README.md) | Presents the active conversation and its input surface | — |
| [`ui-chat/`](ui-chat/README.md) | Projects and renders the Chat conversation target | — |
| [`ui-approval/`](ui-approval/README.md) | Presents approval requests and returns user decisions | — |
| [`ui-tool/`](ui-tool/README.md) | Composes Tool call trees and keyed per-Tool views | — |
| [`ui-workflow-run/`](ui-workflow-run/README.md) | Replays durable workflow runs as nested chat disclosures | — |
| [`ui-goal/`](ui-goal/README.md) | Presents and manages the current goal | — |
| [`ui-trajectory/`](ui-trajectory/README.md) | Presents alternate views of agent activity | — |
| [`ui-commands/`](ui-commands/README.md) | Provides session-aware command discovery and dispatch | — |
| [`ui-input-trigger/`](ui-input-trigger/README.md) | Coordinates inline command and reference suggestions | — |
| [`ui-skill/`](ui-skill/README.md) | Adds skill references to inline suggestions | — |
| [`ui-reference/`](ui-reference/README.md) | Unified Web `@file` / `@session` reference source | — |
| [`ui-subagent/`](ui-subagent/README.md) | Provides subagent navigation, child transcript states, and inline references | — |
| [`ui-schedule/`](ui-schedule/README.md) | Lists the current Session's active reminders in a read-only header catalog | — |
| [`ui-jobs/`](ui-jobs/README.md) | Lists this session's background jobs in the conversation header | — |
| [`ui-model-selection/`](ui-model-selection/README.md) | Provides model selection in conversation surfaces | — |
| [`ui-permission-presets/`](ui-permission-presets/README.md) | Configures default permissions and switches the current session's access | — |
| [`ui-plan/`](ui-plan/README.md) | Presents active plan-mode status and its exit control | — |
| [`ui-mode/`](ui-mode/README.md) | Renders the composer mode selector and the session flow strip | — |
| [`ui-settings-plugins/`](ui-settings-plugins/README.md) | Owns the Plugins settings section, its tab extension point, and configurable host-plane plugin cards | — |
| [`ui-user-questions/`](ui-user-questions/README.md) | Presents interactive questions requested by the agent | — |
| [`ui-agent-preset/`](ui-agent-preset/README.md) | Selects a session's agent preset and authors preset compositions | — |
| [`ui-settings/`](ui-settings/README.md) | Hosts the settings interface and its extension areas | — |
| [`ui-settings-general/`](ui-settings-general/README.md) | Settings shell: primary page navigation and single-page dialogs over the section ledger | — |
| [`ui-pages/`](ui-pages/README.md) | Primary-navigation pages (session reminders, environment and components) and the Help page | — |
| [`ui-assets/`](ui-assets/README.md) | Owns the asset hub section: asset grid and list, reports, mode flows, lineage graph, and face detail | — |
| [`ui-projects/`](ui-projects/README.md) | Owns the project management section over the `workspace` and `agentPresets` Remote namespaces | — |
| [`ui-roundtable/`](ui-roundtable/README.md) | Owns the roundtable primary page and its steering surface | — |
| [`ui-redblue/`](ui-redblue/README.md) | Contributes the red/blue prompt editors card to System settings | — |
| [`ui-settings-models/`](ui-settings-models/README.md) | Provides model-provider configuration and DeepSeek onboarding | — |
| [`ui-settings-plugin-inventory/`](ui-settings-plugin-inventory/README.md) | Contributes the read-only Host Loader inventory tab to Plugins settings | — |
| [`ui-deliverables/`](ui-deliverables/README.md) | Produces the changed-files card with its comparison tabs, delivery cards, and clickable final-response file references | — |
| [`ui-message-feedback/`](ui-message-feedback/README.md) | Contributes per-message feedback controls to the assistant-message action strip | — |
| [`ui-directory-picker-browse/`](ui-directory-picker-browse/README.md) | In-app directory browsing surface for the workspace directory flow | — |
| [`ui-directory-picker-native/`](ui-directory-picker-native/README.md) | Native directory-picker surface driving the host's OS chooser | — |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference and the two notes that own the cross-package composition decisions, then the host half that serves this page.

- [Client modules subsystem](../../docs/subsystems/client-modules.md) — the web plugin table: `dsh.client` declarations, the boot graph wire, and the bundle route.
- [Slot system standard](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the definitive slot model: registration, props shares, and stores.
- [Web client architecture note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — the loading chain, object layer, and client services.
- [Host group map](../host/README.md) — the host half that serves this browser half.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
