---
description: "FinDeck 根 shell：侧栏 chrome（tab、导航、工作区区、设置弹窗、用户卡片）、基于 settings section 注册表的页面路由、详情抽屉与主题投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-shell

[English](README.md) | 中文

## 概述

`dsh-client-ui-shell` 是 FinDeck 的根 shell（UI 重构工单 U1）：它注册接管 runtime 内建 `root` 槽位的框架——固定 236px 侧栏（研究/圆桌 tab、直达导航块、工作区浏览区、设置弹窗入口、用户卡片）加一次一页的主区路由。页面是 `settings.section` 的 id，经新增的 `shell.page` 槽位整页渲染（由 ui-settings-general 的页面宿主占用）；无 id 即会话页（ui-conversation，原样保留）。页面有两种布局：各 section 默认的文档式居中列，以及 shell 授予圆桌的满幅房间布局（无居中列、页面铺满主区并自管滚动——正是侧栏 tab 对已按 id 路由的那个 section）。侧栏底部的「设置」入口直接打开设置弹窗：居中模态，左侧列出设置页，右侧经同一个 `shell.page` 槽位渲染选中页——入口与页面之间不再有展开层。shell 重新声明被替换条目拥有的槽位（`conversation`、`details`、`shell.overlay`、`sidebar.workspaces`），既有 occupants 全部原样挂载，并新增三个自己的槽位：整页的 `shell.page`、右栏 `shell.rightbar`（停靠面，由 ui-sidebar-right 占用），以及 `sidebar.section`——以当前 `settings.section` id 为键的条目在该页打开期间替换工作区浏览区（圆桌的归档历史即用它）。主题投影（自 ui-layout 迁入）与 `ctx.layout` 服务面也归它所有（`toggleSidebar` 收起或展开整列；`openRightbar`/`closeRightbar` 是外壳对该契约的扩展，由右栏席位上报）。弹窗导航栏末尾的「重启服务」条目同样归它所有：请求宿主重启自身进程，并在替代进程应答后重载本页。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与后置工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

作为 web profile 的根 shell 挂载。需要 `ctx.slots`、`ctx.theme`、`ctx.locale`、`ctx.uiWorkspace`。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-client-ui-shell'
```

无配置。web-app bundle 挂载本行并禁用被替换的 `ui-layout`/`ui-sidebar` 行——同一 profile 同时挂两个 shell 会在子槽位声明冲突处响亮报错（两套导航系统是组合错误，不是可渲染状态）。

文案在 `shell` 词典命名空间（zh 是 key 集合的真值来源；en 必须与之一致）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`ShellFrame`（纯组合面）渲染 `Sidebar` 与路由后的主区；路由在条目的 shell store（`createShellStore`：`section` id 或 `undefined` 表示会话页、设置弹窗的开关与选中分区、详情抽屉）。主操作按钮跟着当前 section 走：在会话页新建一个空白会话（`nav.newSession`），在圆桌页显示「新建圆桌」（`nav.newRoundtable`）并发出 `shell/new-roundtable`，把「新开一张桌」到底意味着什么留给该 section 的所有者。每个整页都在携带返回 affordance（`page.back`）的固定 chrome 条下渲染——整页是路由状态而非模态，侧栏任何导航或会话选中都会直接离开。该条同时也是桌面壳下的窗口拖拽区：桌面壳隐藏系统标题栏、把最小化/最大化/关闭按钮浮在页面之上，该窗口按 `--dsh-shell-topband`（Window Controls Overlay 自身高度，且不低于该条带自身控件所需的 32px）为这些按钮在每一列上方留出条带，该条带本身可拖拽。这条带只属于桌面窗口——它为此在 preload 中标记文档（`html[data-shell="desktop"]`）——普通浏览器标签页因此不预留任何条带，每一列保持自身内边距。同一个标记也决定开关的落点，因为条带正是桌面窗口有、浏览器标签页没有的东西：桌面窗口把开关放在条带左端（不占用任何窗口按钮的位置，并退出拖拽区），浏览器标签页则把它作为侧栏底部用户行的末尾控件——28px 纯图标按钮，由该行的 `align-items: center` 与头像、用户名对齐，并在该标记下隐藏，桌面窗口因此永远只有一个开关。条带是随列存活的那个席位：整列移出框架时，两种壳都改由条带左端承载展开 affordance；在浏览器标签页里，条带只为此状态而存在。条下布局跟着 section 走：圆桌满幅渲染（无居中列、页面自管滚动，经 `shell.page` owner share 上的 `fullBleed` 告知页面宿主），其余 section 一律在居中 860px 列内滚动。会话选中变化会把主区带回会话页——在工作区浏览器里点会话即导航。浏览器标题投影当前会话标题。详情抽屉关闭时保持挂载（状态跨关闭周期存活）。图标是外壳自己的线条图标库（`icons.tsx`）——冻结的原型美术加上设置导轨自有的字形，全部沿用原型的 24×24 / 1.6px 几何——以 SVG symbol 挂载一次；颜色一律走 `--ad-*` token（`ui-theme/src/styles/findeck.css`），它是 FinDeck 配色的唯一来源。

侧栏是 236px 的 border box：FinDeck 组件按原型的全局 `box-sizing: border-box` reset 排版，因此每个带内边距、边框或负外边距出血的满宽盒子都在本地声明该属性（本应用没有全局 reset）。侧栏元素同时发布 `--dsh-sidebar-inline-padding`（它自己的 10px 横向内边距）供 `sidebar.workspaces` 占用者使用：后者按 `--dsh-session-list-edge-inset` 读取，用来定位滚动条槽与边缘出血——这个名字原本由被替换的 `ui-sidebar` 侧栏根持有。

设置弹窗导航栏的最后一个条目是「重启服务」控件（`restart.label`），针对的正是开发期的那个坑：bundle 已重建，服务的却仍是重建之前启动的那个进程；只有弹窗打开时才可达。`RestartController` 调用宿主的 `system/restart` Remote，并且不依据它的返回值渲染任何东西——重启没有可用的应答：宿主在应答之前就先释放了监听套接字，载体通常会在半途断开。控制器改为观察 `ctx.connection` 的连接世代，在出现新一代时重载页面（浏览器会话 cookie 是持久的，重载后仍能通过鉴权）。请求发出 `RECONNECT_GRACE_MS` 后载体依然连着，也会直接重载——对未被替换的页面而言刷新是空操作；`RECONNECT_DEADLINE_MS` 内始终没有替代进程，控件则回到静息态。对于早于该命名空间的宿主，控件保持惰性并在控制台说明原因：只有手动重启才能让它换上更新的宿主。

-----

<a id="model-experience"></a>
## Model Experience

无——shell 是纯 chrome，不触及任何模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## 已知限制与后置工作

<a id="known-limitations-and-deferred-work"></a>

- **工作区浏览器仍是 dsh 视觉**——浏览区原样渲染 `sidebar.workspaces` occupant；按原型极简分组列表重绘随 U2 会话工单交付。
- **设置弹窗的导航栏是 shell 自己的清单**——弹窗列出的是设置页（`SETTINGS_SECTIONS`），而非全部 `settings.section` 注册：本 fork 把整页表面（圆桌房间、研究资产与会话提醒页）也走同一注册表，这些页面保留整页布局。新功能插件注册的 section 只有被 shell 的清单收录后才会出现在弹窗里。
- **新手导览暂不可用**——导览协调器在弹窗 shell 的 occupant（`SettingsRoot`）上，页面 shell 不渲染它；导览随 U5 设置四页回归。
- **侧栏是收起为无，而非收成图标栏**——列宽固定，`toggleSidebar`（与框架自己的开关）直接把整列移出框架，没有 rail 形态。
- **暂无 `--ad-*` 暗色覆盖**——FinDeck 配色亮色先行；暗色值随暗色主题工单交付。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

主题投影与浏览器标题投影随 shell 替换从 ui-layout 迁到本包（已无 profile 挂载 ui-layout 的 root 条目；feature 插件间不能以值导入共享 presenter，故由 shell 自持）。`DocumentTitle` 本体留在 ui-layout 供 AppFrame 使用；shell 在 `ShellFrame` 内联了标题效果，避免孪生组件文件。

</details>
