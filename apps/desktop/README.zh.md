# FinDeck 桌面壳（apps/desktop）

[English](README.md) | 中文

Electron 薄壳：把现有的 FinDeck Web UI 装进一个常驻桌面窗口，并补上浏览器给不了的**控制台三件套**——托盘常驻、全局热键唤起、开机自启（用户开关，默认关）。壳自身不画任何界面，只复用本地服务与现有 Web UI；它**不依赖、也不移植上游 `apps/desktop`**。

| 路径 | 内容 |
|---|---|
| `main/index.js` | 主进程全部逻辑：单例锁、拉起服务、主窗口、托盘、热键、窗口状态 |
| `main/preload.cjs` | 页面标记：在页面脚本之前给文档写 `data-shell="desktop"`，Web 壳据此把顶带留给这个窗口 |
| `electron-builder.yml` | 安装包配置：appId、NSIS 目标、`resources/server` 映射、图标 |
| `assets/` | 应用图标：`icon.ico`（窗口 / 任务栏，含 16/32/48/256）、`icon-16.png`（托盘）、`icon-32.png`、`icon.png`（256 主图）、`generate-icons.py`（再生成脚本） |
| `package.json` | `@deepseek-ai/dsh-desktop`（private，不进发布集），`main: main/index.js`，纯 ESM JS，无构建步骤 |
| `README.md` | 本文件 |

## 启动

`app.isPackaged` 决定走哪条路径。

| 模式 | 服务启动 | token URL 来源 |
|---|---|---|
| 源码检出 | `powershell.exe -File start-findeck.ps1`，与手动启动同一条路径 | 从 `~/.findeck/logs/web-server.out.log` 读回 |
| 安装版 | 用随包携带的 Node（`<安装目录>/runtime/node/bin/node.exe`）运行 `<安装目录>/resources/server/apps/cli/lib/bin.js web --no-open --port <端口>` | 同一条启动行；子进程 stdout 被重定向进同一个日志文件 |

安装版没有检出目录，也不能假定机器上有 Node，因此用安装包自带的 Node 运行时跑服务，完全不经过 PowerShell。两种模式都把子进程或启动器的输出写进同一组日志文件，并且都先请求一次候选 token URL 再加载页面：只有打印该 token 的那次启动会回答 `303`，把 token 换成会话 cookie。

外壳自己 spawn 服务时用的 Node 按形态解析：安装版取 `<安装目录>/runtime/node/bin/node.exe`；检出目录里没有 `runtime/node`，改用机器上的 Node——先查 `PATH`，再查常见安装位置，与 `start-findeck.ps1` 的查找方式一致。

服务**刻意不跑在 Electron 自带的 Node 上**（即 `ELECTRON_RUN_AS_NODE=1` 的 Electron）。本 harness 不支持那种载体：`@deepseek-ai/dsh-app-boot` 通过 `node-addon-require-builtin` 访问 Node 内部 ESM loader，而该原生模块支持的 Electron 指纹不包含本包依赖的 Electron；`dsh-skill-office` 一行也明确拒绝在没有独立 Node 的 Electron 下激活。更何况整个仓库实际验证过的就是普通 Node，所以安装包自带一份，而不是另造一个会分叉的运行时。

端口被占用时两种模式的处理也不同。检出的启动器独占 3081，被非它管理的进程占住时直接拒绝启动；安装版会先看该端口上是否已有一个能自证 token 的 FinDeck 服务并直接采用，否则从 3081 起逐个往后试（3081 → 3082 → …）到第一个空闲端口。壳退出时**故意**让服务继续常驻，所以下次启动是采用它，而不是再起一份。

### 从源码检出启动

前置条件：仓库根目录已 `pnpm install`，且 `pnpm run build` 已产出 `apps/cli/lib/bin.js`（壳通过 `start-findeck.ps1` 启动服务，该脚本会检查这个文件）。

```powershell
# 方式一：走 workspace
pnpm --filter @deepseek-ai/dsh-desktop start

# 方式二：直接进目录
cd apps/desktop
npx electron .
```

`pnpm-workspace.yaml` 的 `allowBuilds` 里已登记 `electron: true`（pnpm 默认拦截依赖的安装脚本，不登记会直接装失败）。如果 electron 的平台二进制从 GitHub 下载过慢，可临时换镜像重跑安装（产物进 `%LOCALAPPDATA%\electron\Cache`，之后不再走网络）：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
pnpm install
```

## 安装包

`scripts/build-desktop-installer.ts` 产出 Windows 安装包：一个不带签名的 NSIS 安装程序，装完双击即可出桌面窗口，**不需要用户预装 Node.js**。

```powershell
# 仓库根目录执行
pnpm run build-desktop-installer
# 等价写法，也是各开关的归属处：
pnpm exec tsx scripts/build-desktop-installer.ts
```

| 开关 | 作用 |
|---|---|
| `--skip-build` | 跳过 `pnpm run build`；要求 `lib/` 与 `apps/web/dist/` 已经产出 |
| `--dry-run` | 只打印将要执行的命令与文件改动，不落盘 |
| `--help` | 打印命令帮助 |

产物都在 `release/` 下：

| 路径 | 内容 |
|---|---|
| `release/FinDeck Setup <版本>.exe` | 安装包。默认按用户安装（`perMachine: false`），安装过程中可选择安装目录 |
| `release/win-unpacked/` | 解包后的应用，直接运行其中的 `FinDeck.exe` 即可；下面的验证跑的就是它 |

可执行文件与安装包**都不签名**。因此首次运行 Windows SmartScreen 会拦一次（“Windows 已保护你的电脑”），需要多点一次“更多信息 → 仍要运行”。这是本构建的预期结果，不是打包缺陷。

### 安装包里有什么

服务端不是 asar 应用。finance 层有三处相对安装根的路径解析——`finance/skills` 与 `runtime/primary-runtime`（都由 `packages/bundle/base/cordis.patch.yml` 指名），以及由 `packages/bundle/web-app` 自身模块 URL 推导出的 `finance/python/.venv`——所以安装目录保持与检出相同的仓库布局，各 workspace 包的构建产物落在检出时所在的路径上。进 asar 的只有 Electron 壳本身，`resources/server` 是普通目录。

| 部分 | 说明 |
|---|---|
| `resources/app.asar` | 壳：`main/`、`assets/icon.ico`、`assets/icon-16.png`、`package.json` |
| `resources/server/runtime/node/` | 壳用来跑服务的 Node 运行时；安装版因此不需要用户装 Node |
| `resources/server/node_modules/` | 物化后的依赖闭包，无符号链接；由 `apps/desktop-runtime-closure` 经 `pnpm deploy --legacy --prod --node-linker=hoisted` 产出 |
| `resources/server/apps/cli/` | 壳拉起的 CLI 入口，放在检出时的路径上 |
| `resources/server/finance/` | `skills`、`pipelines`、`face-spec`、`workbenches`，以及 `python` 的源码与安装脚本 |
| `resources/server/config-examples/` | 凭据与设置的示例文件 |
| `resources/server/packages/preset/agent-presets/presets/` | `apps/cli` 的 `dsh.configTrees` 指名的内置预设配置树 |

**刻意不进包**：Python 虚拟环境（`finance/python/.venv`）、pip 临时目录、机器本地组装的 `runtime/primary-runtime` 载荷、`finance/experiments`、source map，以及可选的 `@openai/codex` / `@anthropic-ai/claude-agent-sdk` 智能体后端。Python 环境由用户在应用内的**设置 → 环境与组件**页按需下载，不属于安装包。`runtime/` 被 gitignore，且是机器本地产物：它的 `dependencies/Lib` 是指向组装它那台机器上 venv 绝对路径的 junction，所以从检出打出来的安装包无法携带它；base bundle 的 `tool-workspace-dependencies` 行会指向部署方在装好 Python 之后自行组装的目录。

`pnpm deploy` 会按各包的 `files` 字段过滤，这比检出时的模块解析更严格。三个补充步骤把闭包补全，任何一步对不上都直接让构建失败，而不是发出一个“首次启动才坏”的目录树：

1. **legacy 提升**：pnpm 的 legacy 提升器放在 deploy 源旁边、而非目标里的直接依赖，逐个拷进目标。
2. **被丢掉的文件**：某个包的 `files` 字段排除了它自己 `exports` 仍然指名的路径（或某个模块的相对导入指向了缺失文件）时，从检出把这些文件补回。
3. **残留链接**：`cosmokit` 与 `schemastery` 这两个 vendored 包的 `link:` 覆盖会以符号链接形式穿过 `pnpm deploy`；它们被替换成真实拷贝，因为安装载荷不能依赖目标机器能解析这些链接。

electron-builder 首次运行会下载打包用的 Electron 发行版，以及 `winCodeSign`、`nsis`、`nsis-resources`；构建过程还要取一次它要落盘的 Node 运行时。访问不了 GitHub 或 nodejs.org 时分别指向镜像：

```powershell
$env:FINDECK_NODE_MIRROR='https://npmmirror.com/mirrors/node/'
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
pnpm run build-desktop-installer
```

## 三件套

| 能力 | 位置 | 说明 |
|---|---|---|
| 托盘常驻 | 通知区域 FinDeck 图标 | 关闭窗口 = 隐藏到托盘，不退出；左键单击图标切换显示 / 隐藏（与热键同）；托盘菜单「显示 FinDeck / 重启 FinDeck / 刷新页面 / 开机自启 / 退出」，「退出」才真正结束 |
| 全局热键 | `Alt+Shift+D` | 任意前台应用下可切换主窗口显示 / 隐藏 |
| 开机自启 | 托盘菜单「开机自启」勾选项 | **默认关闭**；`app.setLoginItemSettings` 只在勾选/取消时写入 HKCU 登录项 |

服务本身是独立常驻进程，退出桌面壳不会杀掉它——这正是托盘常驻的意义：壳关了，正在跑的会话/流水线不受影响。

## 窗口外观

主窗口用 `titleBarStyle: 'hidden'` 加一层透明 `titleBarOverlay`：整条系统标题栏去掉（窗口最上沿没有标题栏底色、也没有那条 1px 分隔线），最小化 / 最大化 / 关闭仍是原生按钮，浮在页面右上角。为避免这些按钮压住内容，Web 壳（`ui-shell`）按 `env(titlebar-area-height)` 在每一列上方留出同样高度的空条带，并让该条带可拖拽；全页视图的返回条（`pageBar`）同样可拖拽。该条带只属于这个窗口：preload（`main/preload.cjs`）在页面脚本之前给文档写 `data-shell="desktop"`，Web 壳据此保留条带；普通浏览器标签页没有这个标记，因此不预留条带（左栏顶部不再留空，侧栏开关改乘侧栏首行）。

关闭按钮仍然走「关闭即隐藏到托盘」的既有语义，退出改用托盘菜单的「退出」。

## 图标资产

窗口标题栏与任务栏读 `assets/icon.ico`（多尺寸 16/32/48/256），托盘读 `assets/icon-16.png`；两者出自同一枚 256px 主图（另有 `icon.png`、`icon-32.png` 备用）。图形是深墨蓝圆角方块 + 上升折线：底色取 `--dsw-static-neutral-bluish-950` 向 `--ad-accent`（#2f54eb）混 18%（得 #1a203d），折线取暗色主题品牌主色 `--dsw-static-deepseek-450`（#5686fe）。纯代码绘制（无设计源文件），8 倍超采样后 LANCZOS 降采样，16px 下仍可辨为上升折线。

改图就改 `assets/generate-icons.py` 里的几何常量再重跑（会覆盖写回 `assets/` 下四个文件）：

```powershell
# 仓库根目录执行；Pillow 只用于生成资源，不是运行时依赖，也未进 requirements-data.txt
& "finance\python\.venv\Scripts\python.exe" apps\desktop\assets\generate-icons.py
```

venv 里没有 Pillow 时先 `& "finance\python\.venv\Scripts\python.exe" -m pip install pillow`。

图标资源缺失或无法解码时，`main/index.js` 退回进程内绘制的 16x16 蓝色方块并 `console.error`——图标问题不会挡住启动。安装版里资源管理器、开始菜单与任务栏显示的也是这枚图标。

## 状态文件

全部位于 `~/.findeck/desktop/`：

| 文件 | 格式 |
|---|---|
| `window-state.json` | `{ "x": number, "y": number, "width": number, "height": number, "isMaximized": boolean }`，move/resize 后防抖写入；窗口最大化时记录还原后的边界 |
| `settings.json` | `{ "openAtLogin": boolean }`，默认 `false` |

删除这两个文件即可回到默认状态（1400x900 居中、自启关闭）。窗口位置若落在已拔掉的显示器上，壳会退回默认尺寸居中显示。

## 无头自检

`--smoke` 走与正常启动相同的路径（单例锁 → 拉起/复用服务 → 读认证 URL → 建隐藏窗口 → 加载完成），打印 `SMOKE OK <url>` 后退出 0；任何一步失败打印 `SMOKE FAIL: ...` 并退出 1。它不创建托盘、不注册热键、不显示窗口。

```powershell
npx electron . --smoke                     # 源码检出
release\win-unpacked\FinDeck.exe --smoke   # 安装版解包目录
```

## 已知限制

- 安装包**不签名**：首次运行 Windows SmartScreen 会拦一次（见上）。
- 检出模式仍需先 `pnpm run build` 让 `apps/cli/lib/bin.js` 存在，否则壳会在错误对话框里提示服务未起来。
- 认证 URL 取自 `~/.findeck/logs/web-server.out.log`，日志里可能还留着上一次启动的旧 token（换服务时日志会被截断，存在时间差）。壳会逐个候选 URL 做 303 校验，只加载属于当前这次启动的 token，因此冷启动会多等几秒才出窗口，而不是加载出一个「需要认证」的页面。
- 检出模式若 3081 端口被非本启动器管理的进程占用，启动器会拒绝启动并让壳报错（日志见 `~/.findeck/logs/web-server.err.log`）。安装版不抢端口：能自证 token 的 FinDeck 服务会被直接采用，否则往下一个空闲端口走。
- 开机自启写的是 `HKCU\...\Run` 下名为 `FinDeck` 的项。检出模式的值是 `<electron.exe> "<apps/desktop 绝对路径>"`，移动仓库后需重新勾选一次；安装版写的是安装出来的可执行文件。壳启动时以及每次切换该开关时，都会顺手删除改名（AlphaDeck → FinDeck）前遗留的 `Run\AlphaDeck` 项，避免机器上留一个会再拉起一份程序的孤儿自启项。
- 全新安装里刻意没有 `finance/python/.venv`；在用户从组件中心装好之前，「环境与组件」页会如实报告它尚未创建。Office 技能解析的 `runtime/primary-runtime` 载荷同样缺席，原因相同，因此这些技能在部署方组装出载荷之前不会给出 LibreOffice Kit 命令行一节。
- 安装版的服务跑在随包的 Node 上，而不是 Electron 自带的 Node 上（原因见[启动](#启动)）。代价是安装包多了一份 Node 运行时，这也是安装程序有几百 MB 的原因之一。

## 实机确认清单

自动化已跑过并通过的部分（见下），这些只需偶尔复验；剩下的只能靠人眼看和真实重启。

**已自动验证**：窗口能打开并加载 FinDeck 页面（标题 `FinDeck`，非「需要认证」页）；`Alt+Shift+D` 在窗口可见 / 隐藏间切换；关闭按钮只隐藏窗口、进程存活；退出壳后服务仍在监听；注册表 `Run` 项随开关出现 / 消失；删掉 `settings.json` 启动不会写入自启项；移动 / 缩放后重启窗口回到原位。

**仍需你在实机上确认**：

1. **托盘图标出现**：启动后看通知区域是否出现深墨蓝圆角方块 + 蓝色上升折线图标（自动化只能确认图标位图非空、尺寸 16x16、`Tray` 与菜单构造成功，看不到通知区域）。
2. **窗口 / 任务栏图标**：任务栏按钮与窗口左上角（Alt+Tab 切换器）显示同一枚图标，而不是 electron 默认图标——`BrowserWindow` 的 `icon` 只在运行时生效，自动化开的是隐藏窗口。
3. **托盘菜单可用**：右键图标 → 菜单有「显示 FinDeck / 重启 FinDeck / 刷新页面 / 开机自启（登录时启动 FinDeck）/ 退出」五项；点「显示 FinDeck」窗口回来，点「重启 FinDeck」进程换新（窗口状态保留），点「刷新页面」页面重新加载（隐藏状态下不会把窗口弹出来），点「退出」进程与图标一起消失。左键单击图标本身也应切换显示 / 隐藏。
4. **自启真的生效**：勾选「开机自启」后重启电脑，确认登录时 FinDeck 自动出现；取消勾选后重启不再出现。
5. **热键在别人为前台时生效**：焦点切到记事本等应用再按 `Alt+Shift+D`（自动化是用注入按键验证的，等价但值得亲眼一看）。
6. **安装包端到端**：运行 `release/FinDeck Setup <版本>.exe`，过掉 SmartScreen 提示，选一个安装目录，确认桌面与开始菜单出现快捷方式；再从快捷方式启动，确认窗口打开、托盘图标出现、**没有弹出浏览器**，以及**设置 → 环境与组件**页能渲染出下载中心列表。
