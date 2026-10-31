# FinDeck desktop shell (apps/desktop)

English | [中文](README.zh.md)

An Electron thin shell: it puts the existing FinDeck Web UI in a resident desktop window and adds the three things a browser cannot provide -- a resident tray icon, a global hotkey, and opt-in autostart. The shell draws no UI of its own; it reuses the local server and the existing Web UI. It neither depends on nor ports upstream's `apps/desktop`.

| Path | Contents |
|---|---|
| `main/index.js` | All main-process logic: the single-instance lock, service startup, the main window, tray, hotkey, window state |
| `main/preload.cjs` | Page marker: writes `data-shell="desktop"` on the document before page scripts run, so the Web shell leaves the caption strip to this window |
| `electron-builder.yml` | Installer configuration: app id, NSIS target, `resources/server` mapping, icons |
| `assets/` | Application icons: `icon.ico` (window / taskbar, 16/32/48/256), `icon-16.png` (tray), `icon-32.png`, `icon.png` (256 master), `generate-icons.py` (regenerator) |
| `package.json` | `@deepseek-ai/dsh-desktop` (private, not part of the published set), `main: main/index.js`, plain ESM JS with no build step |
| `README.md` | This file |

## Launching

`app.isPackaged` selects one of two paths.

| Mode | Server startup | Token URL |
|---|---|---|
| Source checkout | `powershell.exe -File start-findeck.ps1`, the same launcher a manual launch uses | read back from `~/.findeck/logs/web-server.out.log` |
| Installed build | the bundled Node, `<install>/runtime/node/bin/node.exe`, runs `<install>/resources/server/apps/cli/lib/bin.js web --no-open --port <port>` | the same startup line, written into that log file by the child's redirected stdout |

The installed build has no checkout and cannot assume a system Node, so it runs the server on the Node runtime the installer carries. It never invokes PowerShell. Both modes write the child's or launcher's output to the same log files, and both verify a token URL by requesting it before loading the page: only the owning boot answers `303`, which swaps the token for a session cookie.

The Node the shell itself spawns is resolved per mode: an installed build takes `<install>/runtime/node/bin/node.exe`, while a checkout has no `runtime/node` tree and takes the machine's Node -- `PATH` first, then the standard Windows install locations, exactly the search `start-findeck.ps1` performs.

The server deliberately does not run on Electron's own Node (Electron started with `ELECTRON_RUN_AS_NODE=1`). The harness does not support it: `@deepseek-ai/dsh-app-boot` reaches Node's internal ESM loader through `node-addon-require-builtin`, whose supported Electron fingerprints exclude the Electron this package depends on, and the `dsh-skill-office` row refuses to activate under Electron without a standalone Node. Running the server on a plain Node is also the configuration the rest of the repository is exercised against, so the installer carries one rather than reproducing a divergent runtime.

The two modes also differ in what a taken port means. The checkout launcher owns 3081 and refuses to start when a foreign process holds it; the installed build adopts a server already answering its own token on the port, and otherwise walks forward (3081 → 3082 → …) to the first free port. A shell that quits leaves its server resident on purpose, so the next launch adopts it instead of starting a second one.

### From a source checkout

Prerequisite: `pnpm install` at the repository root, and `pnpm run build` must have produced `apps/cli/lib/bin.js` (the launcher checks for that file).

```powershell
# Through the workspace
pnpm --filter @deepseek-ai/dsh-desktop start

# Or from the package directory
cd apps/desktop
npx electron .
```

`pnpm-workspace.yaml`'s `allowBuilds` already lists `electron: true` (pnpm blocks a dependency's install scripts by default, and without that entry installation fails). If the Electron platform binary downloads too slowly from GitHub, install again through a mirror; the artifact lands in `%LOCALAPPDATA%\electron\Cache` and later installs skip the network:

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
pnpm install
```

## Installer

`scripts/build-desktop-installer.ts` builds the Windows installer: an unsigned NSIS setup executable that needs no pre-installed Node.js and opens the desktop window on launch.

```powershell
# From the repository root
pnpm run build-desktop-installer
# Equivalent, and where the flags live:
pnpm exec tsx scripts/build-desktop-installer.ts
```

| Flag | Effect |
|---|---|
| `--skip-build` | Skip `pnpm run build`; `lib/` and `apps/web/dist/` artifacts must already exist |
| `--dry-run` | Print every command and filesystem change without executing |
| `--help` | Print the command's help |

Artifacts, both under `release/`:

| Path | Contents |
|---|---|
| `release/FinDeck Setup <version>.exe` | The installer. Per-user by default (`perMachine: false`), with a page to choose the installation directory |
| `release/win-unpacked/` | The unpacked app, runnable directly by launching `FinDeck.exe`; this is what the verification below runs |

The executable and the installer are **not signed**. Windows SmartScreen therefore shows "Windows protected your PC" on first run, and it takes an extra "More info → Run anyway" to continue. That is expected for this build, not a packaging defect.

### What the installer contains

The server is not an asar application. Three resolutions in the finance layer are relative to the installation root -- `finance/skills` and `runtime/primary-runtime`, both named by `packages/bundle/base/cordis.patch.yml`, and `finance/python/.venv`, derived from `packages/bundle/web-app`'s own module URL -- so the installer carries the same repository layout as the checkout, with each workspace package's built output on the checkout's path. Only the Electron shell is packed into an asar; `resources/server` is a plain directory.

| Part | Notes |
|---|---|
| `resources/app.asar` | The shell: `main/`, `assets/icon.ico`, `assets/icon-16.png`, `package.json` |
| `resources/server/runtime/node/` | The Node runtime the shell runs the server on, so the installed app never asks for a system Node |
| `resources/server/node_modules/` | The deployed dependency closure, symlink-free, built by `pnpm deploy --legacy --prod --node-linker=hoisted` from `apps/desktop-runtime-closure` |
| `resources/server/apps/cli/` | The CLI entry the shell spawns, at its checkout path |
| `resources/server/finance/` | `skills`, `pipelines`, `face-spec`, `workbenches`, and `python`'s sources and installer scripts |
| `resources/server/config-examples/` | Example credentials and settings |
| `resources/server/packages/preset/agent-presets/presets/` | The shipped preset config trees `apps/cli`'s `dsh.configTrees` names |

Not included, by design: the Python virtualenv (`finance/python/.venv`), the pip scratch directories, the machine-local `runtime/primary-runtime` payload, the `finance/experiments` tree, source maps, and the optional `@openai/codex` / `@anthropic-ai/claude-agent-sdk` agent backends. The Python environment is a component the user downloads from the app's own **Settings → Environment & components** page, not part of the installer. `runtime/` is gitignored and machine-local: its `dependencies/Lib` is a junction into the absolute path of the venv that assembled it, so an installer built from a checkout cannot carry it, and the base bundle's `tool-workspace-dependencies` row resolves to a directory the deployment assembles once Python is installed.

`pnpm deploy` filters each workspace package by its `files` list, which is stricter than a checkout's module resolution. Three post-passes complete the closure, and the build fails loudly on any of them rather than shipping a tree that only breaks at first launch:

1. **Legacy hoists** -- direct dependencies pnpm's legacy hoister places beside the deploy source instead of the target are copied in.
2. **Dropped files** -- a package whose `files` list excludes a path its own `exports` map still names (or a relative import that names a missing file) has that file restored.
3. **Staged links** -- the `link:` overrides for the vendored `cosmokit` and `schemastery` survive `pnpm deploy` as symbolic links; they are replaced with real copies, because an installer payload must not depend on the target machine resolving them.

electron-builder's first run downloads the Electron distribution for packaging and the `winCodeSign`, `nsis`, and `nsis-resources` tools; the build also fetches the Node runtime it stages. When GitHub or nodejs.org is unreachable, point each at a mirror:

```powershell
$env:FINDECK_NODE_MIRROR='https://npmmirror.com/mirrors/node/'
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
pnpm run build-desktop-installer
```

## The console-side trio

| Capability | Where | Notes |
|---|---|---|
| Resident tray | The FinDeck icon in the notification area | Closing the window hides to the tray instead of quitting; a left click toggles show/hide (same as the hotkey); the tray menu offers "显示 FinDeck / 重启 FinDeck / 刷新页面 / 开机自启 / 退出", and only "退出" actually ends the process |
| Global hotkey | `Alt+Shift+D` | Toggles the main window from any foreground application |
| Autostart | The tray menu's "开机自启" checkbox | **Off by default**; `app.setLoginItemSettings` writes the `HKCU` login entry only when the box is toggled |

The server is an independent resident process. Quitting the shell does not stop it -- that is the point of the tray: with the shell closed, running sessions and pipelines are unaffected.

## Window appearance

The main window uses `titleBarStyle: 'hidden'` with a transparent `titleBarOverlay`: the whole system title bar is gone (no caption fill and no 1px separator at the window's top edge), while minimize / maximize / close stay native buttons floating over the page's top right. So those buttons never cover content, the Web shell (`ui-shell`) reserves a strip of the same height above every column -- `env(titlebar-area-height)` -- and makes that strip draggable; the full-page view's back bar (`pageBar`) is draggable too. That strip belongs to this window alone: the preload (`main/preload.cjs`) writes `data-shell="desktop"` on the document before page scripts run, and the Web shell reserves the strip only when it sees that marker. A plain browser tab has no marker, so it reserves nothing (the left column does not pad its top, and the sidebar toggle moves to the sidebar's first row).

The close button keeps the existing "close means hide to tray" semantics; quitting goes through the tray menu's "退出".

## Icon assets

The window title bar and taskbar read `assets/icon.ico` (16/32/48/256); the tray reads `assets/icon-16.png`. Both come from the same 256px master (the package also carries `icon.png` and `icon-32.png`). The artwork is a deep ink-blue rounded square with a rising polyline: the background mixes `--dsw-static-neutral-bluish-950` 18% toward `--ad-accent` (#2f54eb), giving #1a203d, and the polyline uses the dark theme's brand accent `--dsw-static-deepseek-450` (#5686fe). It is drawn entirely in code (there is no design source file), 8x supersampled and then LANCZOS-downsampled, and stays legible as a rising polyline at 16px.

To change the artwork, edit the geometry constants in `assets/generate-icons.py` and rerun it; it overwrites the four files under `assets/`:

```powershell
# From the repository root; Pillow generates assets only. It is not a runtime
# dependency and is not in requirements-data.txt.
& "finance\python\.venv\Scripts\python.exe" apps\desktop\assets\generate-icons.py
```

If the venv has no Pillow, install it first: `& "finance\python\.venv\Scripts\python.exe" -m pip install pillow`.

When an icon asset is missing or undecodable, `main/index.js` falls back to a 16x16 blue tile drawn in process and logs to `console.error`; an icon problem never blocks startup. In an installed build, Explorer, the Start menu, and the taskbar show the packaged icon as well.

## State files

All under `~/.findeck/desktop/`:

| File | Format |
|---|---|
| `window-state.json` | `{ "x": number, "y": number, "width": number, "height": number, "isMaximized": boolean }`, written after a debounced move/resize; a maximized window records its restored bounds |
| `settings.json` | `{ "openAtLogin": boolean }`, default `false` |

Deleting both files restores the defaults (1400x900 centered, autostart off). When a saved position falls on a display that is no longer attached, the shell falls back to the default size, centered.

## Headless self-check

`--smoke` takes the same startup path as a normal launch (single-instance lock → start or reuse the service → read the authenticated URL → create a hidden window → wait for load), prints `SMOKE OK <url>`, and exits 0. Any failing step prints `SMOKE FAIL: ...` and exits 1. It creates no tray, registers no hotkey, and never shows the window.

```powershell
npx electron . --smoke                     # checkout
release\win-unpacked\FinDeck.exe --smoke   # installed build
```

## Known limits

- The installer is **unsigned**: SmartScreen warns on first run (see above).
- The checkout mode still needs `pnpm run build` to have produced `apps/cli/lib/bin.js`; otherwise the shell reports in an error dialog that the service did not come up.
- The authenticated URL is read from `~/.findeck/logs/web-server.out.log`, which can still hold a previous boot's token (the log is truncated on the next start, and there is a window between). The shell probes each candidate for a `303` and loads only the token belonging to the current boot, so a cold start takes a few extra seconds to show a window instead of loading a page that asks for authentication.
- A checkout launch refuses to start when a non-launcher process holds 3081 and the shell reports the failure (log at `~/.findeck/logs/web-server.err.log`). An installed launch does not fight over the port: it adopts a FinDeck server that answers its own token there, and otherwise moves to the next free port.
- Autostart writes an `HKCU\...\Run` value named `FinDeck`. A checkout launch stores `<electron.exe> "<apps/desktop absolute path>"`, so moving the checkout requires toggling the box again; an installed launch stores the installed executable. On startup and on every toggle, the shell also deletes the pre-rename `Run\AlphaDeck` entry, so no orphan value is left that would start a second copy.
- `finance/python/.venv` is absent from a fresh installation by design; the data-environment page reports it as not created until the component center installs it. The `runtime/primary-runtime` payload the Office skills resolve is absent for the same reason, so those skills omit their LibreOffice Kit CLI section until a deployment assembles one.
- The installed build runs its server on the bundled Node, not on Electron's; Electron's own Node cannot host it (see [Launching](#launching)). This costs the installer the size of that runtime, which is why the setup executable is a few hundred megabytes.

## Manual verification checklist

What automation has already covered (below) needs only occasional re-checking; the rest needs eyes and a real reboot.

**Already verified automatically**: the window opens and loads the FinDeck page (title `FinDeck`, not an authentication page); `Alt+Shift+D` toggles between visible and hidden; the close button only hides the window and the process stays alive; the service is still listening after the shell exits; the `Run` registry value appears and disappears with the toggle; starting with `settings.json` deleted writes no autostart entry; a moved/resized window comes back where it was.

**Still to confirm on a real machine**:

1. **Tray icon appears**: after launch, the notification area shows the deep ink-blue rounded square with a blue rising polyline (automation can only confirm the icon bitmap is non-empty and 16x16 and that `Tray` and the menu were constructed; it cannot see the notification area).
2. **Window and taskbar icon**: the taskbar button and the window's top-left corner (Alt+Tab switcher) show that icon rather than Electron's default -- `BrowserWindow`'s `icon` takes effect only at runtime, and automation opens a hidden window.
3. **Tray menu works**: right-clicking the icon offers "显示 FinDeck / 重启 FinDeck / 刷新页面 / 开机自启（登录时启动 FinDeck）/ 退出"; "显示 FinDeck" brings the window back, "重启 FinDeck" replaces the process (window state preserved), "刷新页面" reloads the page (without popping a hidden window up), and "退出" removes both the process and the icon. A left click on the icon should also toggle visibility.
4. **Autostart really works**: with "开机自启" checked, reboot and confirm FinDeck appears at login; with it unchecked, confirm it does not.
5. **The hotkey works while another app is focused**: focus Notepad and press `Alt+Shift+D` (automation verifies this with injected keystrokes, which is equivalent but worth seeing once).
6. **The installer end to end**: run `release/FinDeck Setup <version>.exe`, accept the SmartScreen prompt, choose an installation directory, and confirm desktop and Start menu shortcuts appear; then launch from the shortcut and confirm the window opens with the tray icon, that no browser tab opens, and that **Settings → Environment & components** renders its download list.
