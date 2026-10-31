---
description: "FinDeck 信息架构的会话提醒页、环境与组件页与帮助页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pages

[English](README.md) | 中文

## 概述

`dsh-client-ui-pages` 承载 FinDeck 信息架构的三个一级导航入口。「会话提醒」把全部会话的已排定提醒渲染成卡片墙，按提醒类型分组——类型取自提醒提示自带的 [R11] 绑定头——每张卡片带一个由 `scheduleControl` Remote 支撑的暂停/恢复开关与直接删除、一个状态标签（已暂停 / 会话未打开 / 已过期 / 待投递），可复制的提醒模板收在「新建提醒」按钮后的面板里。「环境与组件」是 `componentCatalog` Remote 支撑的组件下载格子：六个可安装运行组件，每个格子给出「已下载」徽章与版本、估算大小、安装位置、依赖与下载按钮，唯一在跑的安装任务渲染成实时字节进度条并带取消。「帮助」渲染快速上手路径（接模型、初始化数据环境、提出金融问题）、模式与流程说明，以及逐条列出已交付能力及其入口的功能地图。每个页面注册一个 `settings.section` 行——id、order、本地化标签——侧边栏页面导航自动纳入，无需改壳。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

挂载本包即可让侧边栏导航出现 FinDeck 入口。它要求 `ctx.slots`、`ctx.locale`，以及已挂载的 `scheduleOverview` / `scheduleControl` / `componentCatalog` Remote 面；所有页面经设置分区契约落位。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-client-ui-pages'
```

无配置项：页面文案在 `ui.pages` 字典命名空间（zh 是键集真源，en 必须与之完全一致）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`SchedulePage` 持有一个加载状态机（`loading` / `error` / `ready`），驱动注入的 `load` 回调并渲染返回结果，点击重试按钮会重新调用回调；`SchedulePage` 还把读到的任务分组、每个任务渲染一张卡片，并通过注入的 `control` 回调驱动暂停与恢复、通过注入的 `remove` 回调驱动删除：卡片一直停在 Remote 上次报告的状态，直到请求返回，随后静默重取数据换新。每张卡片的溢出菜单可复制任务内容，也可直接经 `scheduleControl` Remote 删除任务，没有二次确认。`DataEnvPage` 渲染组件格子，其状态在 `src/client/componentCatalog.ts`：apply 闭包经 `ctx.remote.$stream` 只订阅一次 `componentCatalog.follow`，把 `progress` / `installed` / `failed` 事件折叠进插件级快照 store，每次结束都重取组件清单，并通过注册的 `hooks` 隔间把该 store 交给页面——组件只读一个绑定 hook（`useCatalog`），只调注入的 `reload` / `install` / `cancel` 动作。宿主同一时间只跑一个安装任务，页面据此在跟踪到任务时禁用其他行的下载按钮。`HelpPage` 从 `ui.pages` 字典渲染快速上手步骤、模式与流程说明与功能地图。`src/client/index.ts` 注册字典与三个分区行。

-----

<a id="model-experience"></a>
## 模型体验

无。页面只呈现宿主提供的数据，没有任何内容进入模型请求。

#### KV Cache 效应

无；本包既不组装也不发送提供方请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **帮助页只有文字**——页面承载快速上手步骤、模式与流程说明与功能地图；没有图文导览，也没有页内文档浏览器。
- **正在跑的安装没有续点**——组件区块靠 `componentCatalog.follow` 流跟踪唯一任务，流断开后进度行会被清掉，下一次取清单只能恢复已安装状态，恢复不了已下载的字节数。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
