/**
 * FinDeck desktop shell (Electron main process).
 *
 * The shell owns no UI of its own: it makes sure the local FinDeck web server
 * is up, reads the authenticated `?token=` URL that server prints at startup,
 * and points one BrowserWindow at it. Around that window it provides the
 * console-side trio -- a resident tray icon, a global hotkey, and an opt-in
 * autostart entry -- plus window-state persistence.
 *
 * Two launch modes, chosen by `app.isPackaged`:
 *
 * - A source checkout runs `start-findeck.ps1` (the same path a manual launch
 *   uses) and reads the token URL the launcher leaves in the server log.
 * - An installed build has no checkout, so it runs the server itself on the
 *   Node runtime the installer stages under `resources/server`. The token URL
 *   is read from that child's stdout.
 *
 * `--smoke` runs the same startup path headlessly (hidden window, no tray, no
 * hotkey), prints `SMOKE OK <url>` once the page finishes loading, and exits.
 *
 * All mutable state lives under `~/.findeck/desktop/`: `window-state.json`
 * (bounds + maximized flag) and `settings.json` (`{ openAtLogin: boolean }`,
 * default false).
 */

import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, nativeImage, screen } from 'electron'

/**
 * Repository root that owns the launcher script, the finance layer, and the
 * built CLI entry. A source checkout runs this app with `app.getAppPath()` at
 * `apps/desktop`, so the root is two levels up; an installed build carries the
 * same repository layout as `resources/server`. `FINDECK_REPO` overrides both
 * for a relocated checkout.
 */
const REPO_ROOT = process.env.FINDECK_REPO
  ?? (app.isPackaged ? join(process.resourcesPath, 'server') : join(app.getAppPath(), '..', '..'))
const LAUNCHER = join(REPO_ROOT, 'start-findeck.ps1')
/** Built CLI entry inside the runtime tree, at its repository location. */
const SERVER_BIN = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')
/** Node executable name on this platform. */
const NODE_EXE = process.platform === 'win32' ? 'node.exe' : 'node'
/**
 * The Node runtime the installer ships, relative to the installation root, so
 * the installed app never asks the user for one. The server deliberately does
 * not run on Electron's own Node: the loader reaches Node internals through
 * `node-addon-require-builtin`, whose supported Electron fingerprints exclude
 * this build, and `dsh-skill-office` refuses to activate under Electron. A
 * plain Node is the runtime the whole harness is verified against.
 * A source checkout has no `runtime/node`; {@link resolveNodeBin} covers it.
 */
const BUNDLED_NODE = join('runtime', 'node', 'bin', NODE_EXE)
/** Icon assets of this package; `icon.ico` carries 16/32/48/256 for the window. */
const WINDOW_ICON = join(import.meta.dirname, '..', 'assets', 'icon.ico')
const TRAY_ICON = join(import.meta.dirname, '..', 'assets', 'icon-16.png')
/** Marks the loaded document as this shell's window; the web shell reads it (see preload.cjs). */
const PRELOAD = join(import.meta.dirname, 'preload.cjs')
/** Port dedicated to the FinDeck launcher; see start-findeck.ps1. */
const PORT = 3081
/**
 * How many consecutive ports an installed build may try. The launcher owns
 * 3081, but a server left behind by an earlier launch -- or by the checkout's
 * own launcher -- can still hold it, and refusing to start is worse than
 * serving the window from the next free port.
 */
const PORT_ATTEMPTS = 20
const HOTKEY = 'Alt+Shift+D'
const SMOKE = process.argv.includes('--smoke')

/** FinDeck home; the launcher exports `FINDECK_HOME` and `dsh-home-paths` defaults to the same directory. */
const FINDECK_HOME = process.env.FINDECK_HOME ?? join(homedir(), '.findeck')
const LOG_OUT = join(FINDECK_HOME, 'logs', 'web-server.out.log')
const LOG_ERR = join(FINDECK_HOME, 'logs', 'web-server.err.log')
const DESKTOP_DIR = join(FINDECK_HOME, 'desktop')
const WINDOW_STATE_FILE = join(DESKTOP_DIR, 'window-state.json')
const SETTINGS_FILE = join(DESKTOP_DIR, 'settings.json')

const DEFAULT_WINDOW_STATE = { width: 1400, height: 900, isMaximized: false }
const DEFAULT_SETTINGS = { openAtLogin: false }

/** Caption strip the Window Controls Overlay reserves for the native window buttons. */
const TITLEBAR_OVERLAY_HEIGHT = 32
/** Overlay glyph color: the FinDeck shell is a light surface (`--ad-text`). */
const TITLEBAR_SYMBOL_COLOR = '#26262a'

const SERVICE_TIMEOUT_MS = 120_000
const SERVICE_POLL_MS = 250
const MAX_LOAD_RETRIES = 3
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 400
/**
 * Windows reports each half of a tray double click as its own `click`, so the
 * single-click toggle waits this long before it acts; the second click of a
 * double click arrives inside it. 500 ms is the system default double-click
 * time, which Electron does not expose.
 */
const TRAY_CLICK_TOGGLE_DELAY_MS = 500

/** Same pattern start-findeck.ps1 uses to read the token URL back. @param {number} port @returns {RegExp} */
function tokenUrlPattern(port) {
  return new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9_\\-]+`, 'g')
}

let win = null
let tray = null
let isQuitting = false
let saveTimer = null
let trayToggleTimer = null
/** The installed build's own server child; the checkout build leaves this null. */
let server = null

/** @param {string} file @param {object} fallback @returns {object} parsed JSON, or `fallback` when absent or malformed. */
function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    // Windows editors and PowerShell 5.1 write a UTF-8 BOM, which JSON.parse
    // rejects outright; drop it rather than treat a valid file as malformed.
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    // A truncated or hand-edited state file is not worth failing a launch over.
    return fallback
  }
}

/** @param {string} file @param {object} value */
function writeJson(file, value) {
  try {
    mkdirSync(DESKTOP_DIR, { recursive: true })
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error(`could not write ${file}: ${error.message}`)
  }
}

/** @returns {{openAtLogin: boolean}} stored shell settings, autostart defaulting to off. */
function readSettings() {
  const stored = readJson(SETTINGS_FILE, {})
  return { ...DEFAULT_SETTINGS, openAtLogin: stored.openAtLogin === true }
}

/**
 * Last authenticated URL printed into the server log, or null.
 * @param {number} port @returns {string | null}
 */
function readAuthenticatedUrl(port) {
  if (!existsSync(LOG_OUT)) return null
  let text
  try {
    text = readFileSync(LOG_OUT, 'utf8')
  } catch {
    return null
  }
  const matches = text.match(tokenUrlPattern(port))
  return matches && matches.length > 0 ? matches[matches.length - 1] : null
}

/** @returns {string} tail of the server error log, for failure dialogs. */
function readErrorLogTail() {
  if (!existsSync(LOG_ERR)) return ''
  try {
    return readFileSync(LOG_ERR, 'utf8').slice(-2000).trim()
  } catch {
    return ''
  }
}

/**
 * A URL found in the log is not proof it works: the token belongs to one
 * server boot, and the log still holds the previous boot's line until the
 * launcher truncates it. Only the owning boot answers 303 (swapping the token
 * for a session cookie); anything else, including a connection that is not
 * there yet, means the URL must not be loaded. This is the same check
 * `start-findeck.ps1` performs before it reuses a running server.
 * @param {string} url @returns {Promise<boolean>}
 */
function isTokenUrlLive(url) {
  return new Promise((resolve) => {
    const request = get(url, (response) => {
      response.resume()
      resolve(response.statusCode === 303)
    })
    request.setTimeout(2000, () => { request.destroy() })
    request.on('error', () => resolve(false))
  })
}

/** @param {number} ms @returns {Promise<void>} */
function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Reports a startup failure and ends the process: stderr under `--smoke`,
 * otherwise a modal error box.
 * @param {string} message @param {string} [detail]
 */
function fail(message, detail) {
  const text = detail ? `${message}\n\n${detail}` : message
  if (SMOKE) {
    process.stdout.write(`SMOKE FAIL: ${text}\n`)
    app.exit(1)
    return
  }
  dialog.showErrorBox('FinDeck 启动失败', text)
  app.exit(1)
}

/**
 * Runs `start-findeck.ps1` and waits for an authenticated URL that belongs to
 * a running server. The launcher reuses a server it already started on this
 * port, so no separate "is the service alive" branch is needed here; the token
 * check covers both that reuse and a cold start whose log still holds the
 * previous boot's line.
 * @returns {Promise<string>} authenticated `http://127.0.0.1:3081/?token=...` URL
 */
async function ensureServiceFromLauncher() {
  const launcher = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', LAUNCHER, '-NoBrowser', '-Port', String(PORT)],
    { cwd: REPO_ROOT, windowsHide: true, detached: false, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let launcherOutput = ''
  launcher.stdout?.on('data', (chunk) => { launcherOutput += chunk })
  launcher.stderr?.on('data', (chunk) => { launcherOutput += chunk })
  let exitCode = null
  let spawnError = null
  launcher.on('error', (error) => { spawnError = error })
  launcher.on('exit', (code) => { exitCode = code })

  const deadline = Date.now() + SERVICE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const url = readAuthenticatedUrl(PORT)
    if (url && await isTokenUrlLive(url)) return url
    if (spawnError) throw new Error(`无法启动 ${LAUNCHER}: ${spawnError.message}`)
    // Anything non-zero (a throw in the launcher, a foreign process on the
    // port) is final; a clean exit without a URL means the log never got one.
    if (exitCode !== null) {
      const detail = launcherOutput.trim().split(/\r?\n/).slice(-10).join('\n')
      throw new Error(`启动器退出（code ${exitCode}）但日志中没有认证 URL${detail ? `\n${detail}` : ''}`)
    }
    await delay(SERVICE_POLL_MS)
  }
  throw new Error(`等待服务超时（${SERVICE_TIMEOUT_MS / 1000}s）`)
}

/**
 * Whether nothing is listening on a loopback port. The probe binds and
 * immediately closes, so the answer is a snapshot: the server is spawned
 * right after it, and a port lost in between is reported by that child's own
 * startup failure.
 * @param {number} port @returns {Promise<boolean>}
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => { probe.close(() => resolve(true)) })
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * A server already listening on `port` and answering its own boot token, or
 * null. This is what lets a second launch adopt the resident server instead of
 * starting another one: a shell that quits leaves its server running on
 * purpose, and that server's token is only recoverable through the log.
 * @param {number} port @returns {Promise<string | null>}
 */
async function adoptedUrlOnPort(port) {
  const url = readAuthenticatedUrl(port)
  if (url && await isTokenUrlLive(url)) return url
  return null
}

/**
 * Node runtime the shell runs the server on. An installed build carries one
 * under `resources/server`, so the machine needs none; a source checkout has
 * no `runtime/node`, so it uses the Node `start-findeck.ps1` would find: PATH
 * first, then the standard Windows install locations. Electron's own Node is
 * never a candidate ({@link BUNDLED_NODE}).
 * @returns {string | null} absolute path to a Node executable, or null when the machine has none.
 */
function resolveNodeBin() {
  if (app.isPackaged) return join(REPO_ROOT, BUNDLED_NODE)
  const fromPath = findOnPath(NODE_EXE)
  if (fromPath) return fromPath
  for (const dir of [
    process.env.ProgramFiles === undefined ? null : join(process.env.ProgramFiles, 'nodejs'),
    process.env['ProgramFiles(x86)'] === undefined ? null : join(process.env['ProgramFiles(x86)'], 'nodejs'),
    process.env.LOCALAPPDATA === undefined ? null : join(process.env.LOCALAPPDATA, 'Programs', 'nodejs'),
  ]) {
    if (dir !== null && existsSync(join(dir, NODE_EXE))) return join(dir, NODE_EXE)
  }
  return null
}

/** @param {string} exe @returns {string | null} absolute path of `exe` in the first PATH directory that holds it. */
function findOnPath(exe) {
  const separator = process.platform === 'win32' ? ';' : ':'
  for (const dir of (process.env.PATH ?? '').split(separator)) {
    if (dir !== '' && existsSync(join(dir, exe))) return join(dir, exe)
  }
  return null
}

/**
 * Starts the runtime tree's own server as a child of this process and waits
 * for the token URL it prints. The child runs on the Node runtime the installer
 * carries, which is what a machine without Node.js gets instead of an
 * installation step; a checkout uses the machine's own Node
 * ({@link resolveNodeBin}).
 *
 * The child's streams are the log files, not pipes. A pipe would tie the
 * server's lifetime to this shell's -- the write side closes with the parent,
 * and the server dies of the broken pipe -- while quitting the shell is
 * deliberately not a request to stop the server. A file descriptor keeps the
 * server resident and puts its startup line where support already looks.
 * @param {number} port @returns {Promise<string>} authenticated URL for this boot
 */
async function ensureServiceFromRuntime(port) {
  const nodeBin = resolveNodeBin()
  if (nodeBin === null) {
    throw new Error('找不到 Node.js：PATH 与常见安装位置都没有 node；开发形态请先安装 Node.js')
  }
  for (const required of [nodeBin, SERVER_BIN]) {
    if (!existsSync(required)) throw new Error(`运行时缺少 ${required}；安装可能不完整`)
  }
  mkdirSync(join(FINDECK_HOME, 'logs'), { recursive: true })
  const out = openSync(LOG_OUT, 'w')
  const err = openSync(LOG_ERR, 'w')
  server = spawn(
    nodeBin,
    [SERVER_BIN, 'web', '--no-open', '--port', String(port)],
    {
      cwd: REPO_ROOT,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', out, err],
      env: {
        ...process.env,
        // The fork-owned home wins over any DSH_HOME an outer shell exported;
        // both are set so a child that only knows DSH_HOME lands here too.
        FINDECK_HOME,
        DSH_HOME: FINDECK_HOME,
        DSH_WEB_PORT: String(port),
      },
    },
  )
  let exitCode = null
  let spawnError = null
  server.on('error', (error) => { spawnError = error })
  server.on('exit', (code) => { exitCode = code })
  // The server outlives this shell by design; without this the shell would
  // hold a libuv handle on a process it never intends to wait for.
  server.unref()
  // The child holds its own duplicates; keeping these would leak them for the
  // shell's whole lifetime.
  closeSync(out)
  closeSync(err)

  const deadline = Date.now() + SERVICE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const announced = readAuthenticatedUrl(port)
    if (announced && await isTokenUrlLive(announced)) return announced
    if (spawnError) throw new Error(`无法启动服务 ${SERVER_BIN}: ${spawnError.message}`)
    if (exitCode !== null) {
      const detail = readErrorLogTail().split(/\r?\n/).slice(-10).join('\n')
      throw new Error(`服务退出（code ${exitCode}）但没有打印认证 URL${detail ? `\n${detail}` : ''}`)
    }
    await delay(SERVICE_POLL_MS)
  }
  throw new Error(`等待服务超时（${SERVICE_TIMEOUT_MS / 1000}s）`)
}

/**
 * Installed build: adopt a resident server or start one, walking forward from
 * the launcher's port while it is taken. A port held by a server this shell
 * did not start is skipped rather than fought over.
 * @returns {Promise<string>} authenticated URL of the server the window shows
 */
async function ensureServiceFromInstalledRuntime() {
  for (let port = PORT; port < PORT + PORT_ATTEMPTS; port += 1) {
    const adopted = await adoptedUrlOnPort(port)
    if (adopted) return adopted
    if (!await isPortFree(port)) continue
    return await ensureServiceFromRuntime(port)
  }
  throw new Error(`端口 ${PORT}-${PORT + PORT_ATTEMPTS - 1} 都不可用`)
}

/**
 * Ensure a FinDeck web server is up and return its authenticated URL. A source
 * checkout keeps the launcher path (`start-findeck.ps1`, the same one a manual
 * launch uses); an installed build runs the staged runtime itself.
 * @returns {Promise<string>}
 */
async function ensureService() {
  return app.isPackaged ? ensureServiceFromInstalledRuntime() : ensureServiceFromLauncher()
}

/** @param {{x:number,y:number,width:number,height:number}} bounds @returns {boolean} */
function isOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return bounds.x < area.x + area.width
      && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height
      && bounds.y + bounds.height > area.y
  })
}

/** @returns {{x?:number,y?:number,width:number,height:number,isMaximized:boolean}} */
function loadWindowState() {
  const stored = readJson(WINDOW_STATE_FILE, {})
  const state = {
    ...DEFAULT_WINDOW_STATE,
    ...stored,
    isMaximized: stored.isMaximized === true,
  }
  if (typeof state.width !== 'number' || typeof state.height !== 'number') {
    return { ...DEFAULT_WINDOW_STATE }
  }
  const placed = Number.isInteger(state.x)
    && Number.isInteger(state.y)
    && isOnSomeDisplay({ x: state.x, y: state.y, width: state.width, height: state.height })
  return placed ? state : { width: state.width, height: state.height, isMaximized: state.isMaximized }
}

/** Writes the current bounds; a maximized window stores its restored bounds. */
function persistWindowState() {
  if (!win || win.isDestroyed()) return
  const isMaximized = win.isMaximized()
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
  writeJson(WINDOW_STATE_FILE, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  })
}

/** Coalesces the move/resize burst a drag produces into one write. */
function scheduleWindowStateSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistWindowState()
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS)
}

/** Shows, restores, and focuses the main window. */
function showWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Global-hotkey and tray action: visible means hide, hidden means show. */
function toggleWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && !win.isMinimized()) {
    scheduleWindowStateSave()
    win.hide()
    return
  }
  showWindow()
}

/**
 * Tray left-click action, the tray's copy of the hotkey's one toggle per
 * gesture: a lone click toggles once the double-click delay has passed, and a
 * second click inside that delay cancels the waiting toggle and toggles once
 * itself. The `double-click` that follows is deliberately unhandled, so a
 * double click neither toggles twice nor toggles back.
 */
function onTrayClick() {
  if (trayToggleTimer) {
    clearTimeout(trayToggleTimer)
    trayToggleTimer = null
    toggleWindow()
    return
  }
  trayToggleTimer = setTimeout(() => {
    trayToggleTimer = null
    toggleWindow()
  }, TRAY_CLICK_TOGGLE_DELAY_MS)
}

/**
 * Creates the single main window and loads the authenticated URL.
 * @param {string} url @param {boolean} show whether to reveal the window on load
 * @returns {Promise<boolean>} true once the page finished loading
 */
function createMainWindow(url, show) {
  const state = loadWindowState()
  const options = { width: state.width, height: state.height, show: false, title: 'FinDeck', autoHideMenuBar: true, icon: WINDOW_ICON }
  // The web shell owns the window's top edge: its sidebar tab row and page
  // chrome start at y=0, so an OS title bar sits above them as a strip. A
  // hidden title bar removes the strip; the Window Controls Overlay keeps the
  // native minimize/maximize/close buttons floating over the content with no
  // fill. The served page supplies the drag region the caption used to provide
  // (the page chrome bar, see ui-shell's ShellFrame.module.css). On macOS the
  // traffic lights stay in place under `hidden`, so no overlay is needed.
  if (process.platform !== 'darwin') {
    options.titleBarStyle = 'hidden'
    options.titleBarOverlay = {
      color: 'rgba(0, 0, 0, 0)',
      symbolColor: TITLEBAR_SYMBOL_COLOR,
      height: TITLEBAR_OVERLAY_HEIGHT,
    }
  }
  if (Number.isInteger(state.x) && Number.isInteger(state.y)) {
    options.x = state.x
    options.y = state.y
  }
  win = new BrowserWindow({
    ...options,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: PRELOAD },
  })

  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    scheduleWindowStateSave()
    win.hide()
  })
  for (const event of ['move', 'resize', 'maximize', 'unmaximize']) {
    win.on(event, scheduleWindowStateSave)
  }

  return new Promise((resolve) => {
    let loadFailures = 0
    let revealed = false
    win.webContents.on('did-finish-load', () => {
      // Only the first load reveals the window: a tray "刷新页面" of a hidden
      // window must not pop it up.
      if (show && !revealed) {
        revealed = true
        if (state.isMaximized) win.maximize()
        win.show()
        win.focus()
      }
      resolve(true)
    })
    win.webContents.on('did-fail-load', (_event, _code, description, _validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      if (loadFailures >= MAX_LOAD_RETRIES) {
        fail(
          `加载 ${url} 失败：${description}`,
          `服务未起来，看 ${LOG_ERR}`,
        )
        resolve(false)
        return
      }
      loadFailures += 1
      // The server can drop one connection while it swaps the boot token for
      // its session cookie; retrying re-runs that exchange.
      setTimeout(() => {
        if (!win.isDestroyed()) win.loadURL(url)
      }, 1000)
    })
    win.loadURL(url)
  })
}

/** @param {number} x @param {number} y @param {number} size @param {number} radius @returns {boolean} */
function isInsideRoundedSquare(x, y, size, radius) {
  let dx = 0
  let dy = 0
  if (x < radius) dx = radius - 0.5 - x
  else if (x >= size - radius) dx = x - (size - radius - 0.5)
  if (y < radius) dy = radius - 0.5 - y
  else if (y >= size - radius) dy = y - (size - radius - 0.5)
  return dx * dx + dy * dy <= radius * radius
}

/**
 * Fallback tray icon drawn in process -- a rounded blue tile -- used only when
 * the packaged asset is missing or undecodable, so an icon problem never stops
 * the shell from starting. Buffer layout is BGRA with full alpha.
 * @returns {import('electron').NativeImage}
 */
function createTrayIcon() {
  const size = 16
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isInsideRoundedSquare(x, y, size, 3)) continue
      const offset = (y * size + x) * 4
      pixels[offset] = 0xd6
      pixels[offset + 1] = 0x62
      pixels[offset + 2] = 0x0f
      pixels[offset + 3] = 0xff
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size })
}

/**
 * The registry value name of the autostart entry. Electron's default for an
 * unpackaged app is the generic `electron.app.Electron`, which every other
 * unpackaged Electron app would share; naming it keeps this entry identifiable
 * and stops two such apps from overwriting or removing each other.
 */
const LOGIN_ITEM_NAME = 'FinDeck'

/**
 * The registry value name this shell wrote before the FinDeck rename. That
 * entry launches the same app, so leaving it behind would start a second copy;
 * removing it is not the "never clear an entry the user added outside the
 * shell" case that governs {@link LOGIN_ITEM_NAME}.
 */
const LEGACY_LOGIN_ITEM_NAME = 'AlphaDeck'

/** Deletes the pre-rename autostart entry; the Windows registry value is the only place one exists. */
function removeLegacyLoginItem() {
  if (process.platform !== 'win32') return
  app.setLoginItemSettings({ openAtLogin: false, name: LEGACY_LOGIN_ITEM_NAME })
}

/**
 * Builds the login-item settings for this app. An unpackaged Electron binary
 * does not know which app to run, so the app directory has to travel as an
 * argument; a packaged build carries the app itself.
 * @param {boolean} openAtLogin @returns {object}
 */
function loginItemSettings(openAtLogin) {
  const settings = { openAtLogin, name: LOGIN_ITEM_NAME }
  if (!app.isPackaged) settings.args = [app.getAppPath()]
  return settings
}

/**
 * Writes the setting and applies it to the login item. This is the only path
 * that may turn autostart off; the shell never enables it on its own.
 * @param {boolean} openAtLogin
 */
function setOpenAtLogin(openAtLogin) {
  writeJson(SETTINGS_FILE, { openAtLogin })
  removeLegacyLoginItem()
  app.setLoginItemSettings(loginItemSettings(openAtLogin))
}

/**
 * Re-asserts a previously chosen autostart at login. A stored `false` is
 * deliberately not written back: the shell must neither enable autostart by
 * default nor clear an entry the user added outside it.
 * @param {{openAtLogin: boolean}} settings
 */
function applyStoredLoginItem(settings) {
  if (settings.openAtLogin) app.setLoginItemSettings(loginItemSettings(true))
}

/**
 * The tray icon from `assets/icon-16.png`, falling back to the in-process
 * bitmap. An unusable asset is reported and then ignored: the notification
 * area is not worth refusing to launch over.
 * @returns {import('electron').NativeImage}
 */
function loadTrayIcon() {
  if (existsSync(TRAY_ICON)) {
    const icon = nativeImage.createFromPath(TRAY_ICON)
    if (!icon.isEmpty()) return icon
    console.error(`tray icon ${TRAY_ICON} did not decode; falling back to the in-process bitmap`)
  } else {
    console.error(`tray icon ${TRAY_ICON} is missing; falling back to the in-process bitmap`)
  }
  return createTrayIcon()
}

/**
 * Tray action: reloads the page in the main window. With no window to reload
 * the show path runs instead, which is the only thing left that can put the
 * page back.
 */
function reloadWindow() {
  if (!win || win.isDestroyed()) {
    showWindow()
    return
  }
  win.webContents.reload()
}

/**
 * Frees what this process owns at quit: the hotkey registration and the tray
 * icon. `app.exit` emits neither `before-quit` nor `will-quit`, so the restart
 * below calls this itself.
 */
function releaseShellResources() {
  globalShortcut.unregisterAll()
  if (tray) {
    tray.destroy()
    tray = null
  }
}

/**
 * Tray action: replaces the whole shell with a fresh process. `relaunch` starts
 * the successor once this one is gone, so the rebooted shell takes the
 * single-instance lock without contention with the exiting one.
 */
function restartShell() {
  isQuitting = true
  persistWindowState()
  releaseShellResources()
  app.relaunch()
  app.exit(0)
}

/** @param {{openAtLogin: boolean}} settings @returns {boolean} whether the icon was usable. */
function createTray(settings) {
  const icon = loadTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('FinDeck')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 FinDeck', click: () => showWindow() },
    { type: 'separator' },
    { label: '重启 FinDeck', click: () => restartShell() },
    { label: '刷新页面', click: () => reloadWindow() },
    { type: 'separator' },
    { label: '开机自启（登录时启动 FinDeck）', type: 'checkbox', checked: settings.openAtLogin, click: (item) => setOpenAtLogin(item.checked) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]))
  tray.on('click', onTrayClick)
  return !icon.isEmpty()
}

/** Registers the show/hide hotkey; a taken combination only loses the hotkey. */
function registerHotkey() {
  if (!globalShortcut.register(HOTKEY, toggleWindow)) {
    console.error(`global hotkey ${HOTKEY} is already taken; the tray menu still opens the window`)
  }
}

async function runApp() {
  const settings = readSettings()
  removeLegacyLoginItem()
  applyStoredLoginItem(settings)
  let url
  try {
    url = await ensureService()
  } catch (error) {
    const tail = readErrorLogTail()
    fail('FinDeck 本地服务未起来。', `${error.message}\n\n看 ${LOG_ERR}${tail ? `\n\n${tail}` : ''}`)
    return
  }
  const loaded = await createMainWindow(url, !SMOKE)
  if (!loaded) return
  if (SMOKE) {
    process.stdout.write(`SMOKE OK ${url}\n`)
    // One more turn of the loop so the line reaches the console before exit.
    setTimeout(() => app.exit(0), 50)
    return
  }
  const iconOk = createTray(settings)
  if (!iconOk) console.error('tray icon bitmap was empty; the tray entry may be invisible')
  registerHotkey()
}

if (!app.requestSingleInstanceLock()) {
  // A shell is already running; that instance's `second-instance` handler
  // raises its window, so this process has nothing left to do.
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.on('window-all-closed', () => {
    // Tray-resident: closing the last window must not stop the shell.
  })
  app.on('before-quit', () => {
    isQuitting = true
    persistWindowState()
  })
  app.on('will-quit', () => releaseShellResources())
  app.whenReady().then(runApp).catch((error) => fail('桌面壳启动失败。', String(error?.stack ?? error)))
}
