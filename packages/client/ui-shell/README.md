---
description: "FinDeck root shell: sidebar chrome (tabs, nav, workspaces region, settings dialog, user card), page routing over the settings section registry, the details drawer, and theme projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-shell

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-shell` is the FinDeck root shell (UI rebuild, work item U1): it contributes the frame that owns the runtime's built-in `root` slot — a fixed 236px sidebar (research/roundtable tabs, direct nav block, the workspaces browsing region, the settings entry, the user card) beside a main area whose route is one page at a time. Pages are `settings.section` ids rendered full-page through the new `shell.page` hole (occupied by ui-settings-general's page host); the conversation (ui-conversation, unchanged) is the page an absent id means. Pages come in two layouts: the document-style centered column every section gets by default, and the full-bleed room layout the shell grants the roundtable (no centered column, the page spans the main area and owns its scrolling — the same section id the sidebar's tab pair already routes). The sidebar's bottom settings entry opens the settings dialog directly — a centered modal whose left rail, and the sidebar's plugin pages, are the live `settings.section` registrations that declare a place, an icon name, and an order — a section with no registration is not listed. The research and roundtable tabs, New session, and the settings entry stay shell chrome. The rail's right side renders the selected one through the same `shell.page` hole — so no expansion stands between the entry and the page. The shell re-declares the occupant-facing holes the replaced entries owned (`conversation`, `details`, `shell.overlay`, `sidebar.workspaces`), so every shipped occupant mounts unchanged, and contributes three holes of its own: the full-page `shell.page`, the right column `shell.rightbar` (the docking surface, ui-sidebar-right), and `sidebar.section` — an entry keyed by the active `settings.section` id replaces the workspaces browsing region for as long as that page is open (the roundtable's archive history uses it). It also owns theme projection (moved from ui-layout), the `ctx.layout` service face (`toggleSidebar` hides or shows the whole column; `openRightbar`/`closeRightbar` are the shell's addition to that contract, reported by the right column's occupant), and the dialog's *Restart service* entry, which asks the host to restart its own process and reloads this page once a replacement answers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package as the root shell of a web profile. It requires `ctx.slots`, `ctx.theme`, `ctx.locale`, and `ctx.uiWorkspace`.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-client-ui-shell'
```

No configuration. The web-app bundle mounts this row and disables the replaced `ui-layout`/`ui-sidebar` rows — mounting both shells in one profile fails loud on the child-slot declaration conflict (two navigation systems is a composition error, not a state to render through).

Copy lives in the `shell` dictionary namespace (zh is the key-set source of truth; en must match it exactly).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`ShellFrame` (pure composition face) renders `Sidebar` plus the routed main area; the route lives in the entry's shell store (`createShellStore`: `section` id or `undefined` for the conversation, the settings dialog's open flag and selected section, the details drawer, and the right column's four reported facts plus the frame measurement its owner share resolves against). The right column is the shell's third hole, `shell.rightbar` (occupied by ui-sidebar-right): the aside beside `main` reserves the track, the occupant draws the panel itself against the frame's right edge and reports through `ctx.layout.openRightbar`/`closeRightbar` whether it is shown and whether it wants that track, and the shell solves the width the way ui-layout's `computeColumns` did — the saved preference clamped to 300px…70% of the frame, shrunk to what the sidebar and a 400px centre leave, and gone entirely below 300px — so the occupant's own auto-collapse sees a truthful `canShow`. The primary nav action follows the section: the conversation opens a blank session (`nav.newSession`), and the roundtable reads *New Roundtable* (`nav.newRoundtable`) and emits `shell/new-roundtable`, leaving what starting over means to that section's owner. Every full page renders under a fixed chrome bar carrying the back affordance (`page.back`); a page is route state, not a modal — any sidebar navigation or session selection leaves it directly. That bar is also the window drag region under the desktop shell, whose hidden title bar leaves its native minimize/maximize/close buttons floating over the page: that window reserves their band above every column at `--dsh-shell-topband` (the Window Controls Overlay's own height, never below the 32px the band's own controls need) and makes that band draggable. The band belongs to the desktop window alone — it marks the document (`html[data-shell="desktop"]`, written by the shell's preload) for exactly that — so a plain browser tab reserves nothing and every column keeps its own inset. The marker also picks the toggle's home, because the band is what the desktop window has and a browser tab does not: there the toggle is the band's left-end control (where no window button sits, opted out of the drag region), while a browser tab carries it as the trailing control of the sidebar's bottom user row — a bare 28px icon button that the row's `align-items: center` sits level with the avatar and the name, hidden under the marker so the desktop window never shows two. The band is the one seat that survives the column: while the sidebar is out of the frame, its left end carries the expand affordance in both shells, and in a browser tab the strip exists for that state alone. Below that bar the page layout follows the section: the roundtable renders full-bleed (no centered column, the page owns its scrolling, reported to the page host as `fullBleed` on the `shell.page` owner share), while every other section scrolls in the centered 860px column. A session selection change returns the main area to the conversation — clicking a session in the workspaces browser is navigation. The browser title projects the current session title. The details drawer stays mounted while closed (state survives close cycles). Icons are the shell's line-icon library (`icons.tsx`) — the frozen prototype artwork plus the settings rail's own glyphs, all on the prototype's 24×24/1.6px geometry — mounted once as SVG symbols; colors resolve through the `--ad-*` token scale (`ui-theme/src/styles/findeck.css`), the single source of the FinDeck palette.

The sidebar column is a 236px border box: the FinDeck components are laid out for the prototype's global `box-sizing: border-box` reset, so every full-width box that carries padding, a border, or a negative-margin bleed declares it locally (the app has no global reset). The sidebar element also publishes `--dsh-sidebar-inline-padding` (its own 10px inline padding) for the `sidebar.workspaces` occupant, which reads it as `--dsh-session-list-edge-inset` to place its scrollbar gutter and edge bleeds — the name the replaced `ui-sidebar` sidebar root used to own.

As the settings dialog's last rail entry, the *Restart service* control (`restart.label`) covers the development case where a rebuilt bundle is still served by the process that started before it; it is reachable only while the dialog is open. `RestartController` calls the host's `system/restart` Remote and renders nothing about the outcome, because a restart has no usable reply: the host releases its listener before it answers, so the carrier usually drops mid-call. The controller instead watches `ctx.connection`'s generation and reloads the page when a new one arrives (the browser session cookie is durable, so the reload authenticates). A carrier still connected `RECONNECT_GRACE_MS` after the request reloads anyway — a refresh of an unreplaced page is a no-op — and `RECONNECT_DEADLINE_MS` without a replacement returns the control to rest. A host that predates the namespace leaves the control inert, naming itself in the console: only a manual restart can serve it a newer host.

-----

<a id="model-experience"></a>
## Model Experience

None, as the shell is pure chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The workspace browser keeps its dsh visuals** — the browsing region renders the `sidebar.workspaces` occupant unchanged; restyling it to the prototype's minimal grouped list arrives with the U2 conversation work.
- **The settings dialog's rail is the shell's own list** — the dialog lists the settings pages (`SETTINGS_SECTIONS`), not every `settings.section` registration: this fork routes whole-page surfaces (the roundtable room, the research-assets and session-reminders pages) through that same registry, and those keep their full-page layout. A section registered by a new feature plugin appears in the dialog only after the shell's list names it.
- **Onboarding is dormant** — the settings onboarding coordinator lived on the modal shell's occupant (`SettingsRoot`), which the page shell does not render; the tour returns with the U5 settings pages.
- **The sidebar collapses to nothing, not to a rail** — the column is fixed-width, so `toggleSidebar` (and the frame's own toggle) hides the whole column; there is no icon rail.
- **No dark `--ad-*` overrides yet** — the FinDeck palette is light-first; dark values arrive with the dark-theme work item.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Theme projection and the browser-title projection moved here from ui-layout with the shell replacement (no profile mounts ui-layout's root entry anymore; feature plugins cannot share the presenter as a value import, so the shell carries its own). `DocumentTitle` itself stays in ui-layout for AppFrame; the shell inlines the effect in `ShellFrame` to avoid a twin component file.

</details>
