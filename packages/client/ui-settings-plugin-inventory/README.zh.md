---
description: "dsh Web 客户端的「插件」页面主体：上半区是可开关的用户插件卡片，下半区是默认折叠的系统插件区（配置视图 + 只读清单）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

[English](README.md) | 中文

## 概述

`dsh-client-ui-settings-plugin-inventory` 贡献 Web 设置**插件**页的主体。挂载时它调用一次 `ctx.remote.pluginInventory.list()`，并渲染两个区。上半区「插件」把目录中标记过的、可选且面向用户的插件列成卡片——名称、一句话描述，以及一个把该条目的 `disabled` 事实写进用户 patch 层（`$DSH_HOME/cordis.patch.yml`）的开关；关闭方向会先问一次，因为停用会静默移除该插件提供的东西。下半区「系统插件」是默认折叠的披露区：区头带系统插件计数，展开后依次堆叠注册到 `settings.plugins.system` 的配置视图，以及只读清单。该清单保留两个可折叠分组：Agent 预设组在前、默认展开，一个只改显示的切换器胶囊覆盖 roster，每个组合行是一张紧凑折叠卡片，携带其启停状态——含宿主无法求值的 disabled 门对应的 `conditional`——出处事实收在折叠里。全局组随后，组头带过滤后的条目计数与失败计数；展开后失败行浮在最前，全局停用但被至少一个预设启用的条目就地标记为预设提供——详情列出启用它的预设——而不是读作单纯的已停用。搜索过滤系统清单、强制撑开收起的分组，并指出未选中预设里的匹配。加载、空结果、无匹配与通用失败状态只属于已挂载组件，读取失败后可以重试，且不会暴露传输细节；没有 roster 时主体只渲染全局平面。上半区未拥有的全局行同样带这个开关。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开设置中的「插件」分区。上半区就是用户可管理的插件卡片；展开下方的**系统插件**区，即可看到配置视图与宿主的插件清单。插件激活期间不读取 Remote——页面挂载时通过 `api-remotes` 调用 `ctx.remote.pluginInventory.list()` 与 `ctx.remote.pluginPatch.read()`。

### 用户可管理的卡片

当 Loader 条目的模块命中目录里标记为 `managed` 的行时，该插件显示为一张卡片。这个标记代表「可选且面向用户」：没有它本部署照样启动与服务，停用只会削弱它所提供的功能，而且同一张卡片可以撤销该决定。传输、会话、设置、沙箱、提示词与 shell 插件是承重的，留在系统区——同样的开关在那里也可用，只是卡片与参考清单放在一起。

拨动开关会把该 Loader 条目 id 的一条 `disabled` 事实写进用户 patch 层。调用方可以传 patch id，也可以传 Loader 带前缀的条目 id；文件里记下的是 patch id。`pluginPatch.write` 也接受一组 `{ id, disabled }`，一次写完文件，因此 live reload 只发生一次；任一 id 不在当前 Loader 里则整组拒绝，文件保持原样。该层在所有 bundle 层之后应用，声明了 `patchReload: live` 的 profile（内置 Web profile 即是）会在写入时重整配置树，因此开关无需重启即可生效。关闭方向先要求确认，因为它会静默移除该插件提供的东西；启用则一次点击完成。写入失败时开关保留运行时的实际状态，并在区上方报告失败；patch 读取失败不会改变任何开关，但会把下次写入计入失败。

### 阅读卡片

每张收起的卡片使用模块短名称作为标题，并以小标签表示启停状态；已启用的条目还会显示彩色根 fiber 状态圆点。展开卡片后会显示声明的条目 id、完整模块标识与状态事实：预设行说明它来自哪个预设、组合存活时的运行状态，以及它携带的禁用条件；被预设提供的全局行说明它由 Agent 预设按会话提供、列出启用它的预设，并提供跳转到预设组的入口。预设名经共享的 `presetDisplayText` 纯函数（`dsh-agent-presets/display`）叠在 [`ui-agent-preset`](../ui-agent-preset/README.zh.md) 的字典上解析：内置预设走当前语言，用户自建预设保留自己的元数据，因此英文界面不会回显预设文件里的中文名。搜索按模块名称与条目 id 过滤系统清单。

### 预设切换器

切换器与通用设置各行使用同一种「选择胶囊 + 菜单」控件。它列出 roster 的每个预设——默认项带后缀、坏预设带标记——并且只改变列表显示什么：它不写任何设置，选中坏预设时在行的位置展示 discovery 报告的原因。选默认预设或某个会话的预设仍在原处：Agent 预设分区与新会话页。

### 重试失败的读取

读取失败会在页面内渲染通用失败状态；重试会重新执行 `list()` 调用，且不会暴露传输细节。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该页面主体是宿主拥有快照的投影加一条写入路径；插件激活期间不执行任何 Remote 读取，挂载时才取快照。

### 注册

浏览器插件注册一个 id 为 `plugins-body` 的本地化 `settings.plugins.body` 贡献，并声明 `settings.plugins.system` 作为它的子 slot——配置视图堆叠进它折叠系统区里的座位。「插件」分区拥有导航入口与页面外壳。注册使用 `ctx.slots.inject()`，因此能跟随延迟声明、重新声明、本地化变化与 teardown，而无需 import 分区拥有方。

### 渲染

行 key 按作用域限定（`user:`、`global:`、`preset:<id>:<index>`），因此同一模块出现在两个作用域时保持各自的展开状态；条目 id 只在行声明了它时作为详情展示，代码不按字符串形状对它分类。用户可管理集合是按目录标记对 Loader 清单的客户端切分，而非宿主分类：上半区放标记过的行，系统区放其余行。预设提供标记在客户端推导：一个全局条目在全局被停用、且至少一个预设行对同一模块标识实际启用时才携带它，因此被所有预设关掉（或仅条件声明）的模块保持单纯的已停用，而不是夸大提供关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖设置分区、Remote 调用与宿主侧投影。

- [ui-settings-plugins](../ui-settings-plugins/README.zh.md)——本包填充其页面主体的「插件」分区，以及它堆叠的配置视图。
- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.plugins.body` 与 `settings.plugins.system` 的领域底座。
- [api-remotes](../../api/remotes/README.zh.md)——`pluginInventory.list()` 与 `pluginPatch.read()`/`write()` 背后的 Remote BFF 表面。
- [plugin-inventory](../../host/plugin-inventory/README.zh.md)——本页所渲染的宿主侧只读 Loader 投影。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端插件页面主体，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义本页的新鲜度、触达范围与持久化；它们是当前包约束。

- **每次 Settings 挂载或重试只读取一份快照**：本页不订阅 Loader 变化，也不会在重连后自动重新读取；重新打开 Settings 则会取得新快照。
- **用户/系统切分来自客户端目录标记**：宿主清单不携带用户/系统分类，因此 `catalog.ts` 拥有那份 `managed` 白名单；不在目录中的模块永远不会出现在上半区。
- **patch 写入是持久化的，但不与运行树同事务**：开关只写入用户层，并仅凭写入结果报告成功。声明 `patchReload: startup` 的 profile 要到下次启动才应用，而文案声称即时生效；内置 Web profile 为 `live`。
- **预提供的行不可由用户开关**：某行一旦由预设提供就不带开关，因为它的启停归属预设组合而非用户层。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包持有「插件」页面主体的 Settings contribution 与其写入路径。
