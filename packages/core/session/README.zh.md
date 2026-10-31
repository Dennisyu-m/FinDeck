---
description: "面向用户与维护者的事件溯源会话日志与内存存储说明，用于构建、检查或扩展每个 agent 交互背后的持久记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session

[English](README.md) | 中文

## 概述

`dsh-session` 提供仅追加的会话日志，记录 agent（智能体）的完整交互历史——每个模型可见事实都流经的单一真源。LLM（大语言模型）消息历史由日志*派生*（`deriveMessages()`），从不另行存储，因此回放就是对同一批事件重新派生，压缩（compaction）也可以遮蔽较旧的表层条目而不删除历史。该包还提供内存存储（`ctx.sessions`）、插件通过声明合并扩展的类型化 `SessionEvent` 词汇，以及为产生消息的事件排序的 surface 层。持久化刻意是独立关注点：后端订阅 `session/event` 并在 `session/flush` 时刷新。作为任何 agent 会话的基础时请选择本包；它本身不运行模型调用。

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

在必须存在会话的任何地方挂载 `dsh-session`。它在内存中创建并持有事件溯源的 `Session` 实例；持久存储由订阅 `session/event` 流的持久化插件叠加。

### 创建与检查会话

`ctx.sessions.create()` 构建绑定到调用方 fiber 的实时会话；`get(id)` 与 `list()` 查找会话，`fork()` 从实时会话的稳定前缀创建子会话。

```text
const session = ctx.sessions.create(sessionId, { meta: { cwd: '/workspace' } })
ctx.sessions.get(sessionId)      // the live session
ctx.sessions.list()              // every live session, in creation order
```

### 追加与派生

`session.append(type, data, opts?)` 提交一个类型化事件——它先快照并冻结载荷、校验其为无损 JSON，再通知观察者。`session.deriveMessages()` 把日志投影为模型看到的 `Message[]`，采用增量且有缓存的方式：

```text
session.append('user/message', { role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } },
  { surfaceOp: 'append' })
session.deriveMessages()         // the derived model history
```

表层事件（`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`）必须声明如何进入有序 surface，其首个节点必须是系统提示词，且只能被恰好覆盖该节点的 `system/message` 重写。`developer/message` 记录工具注册表报告的工具集增删：每个 `tool-addition` 命名 `headerSeq` 所引用更早 `request/header` 中已定义的一个工具，`session.toolHistory()` 把两者折叠成循环发送的 `ToolHistory`。Assistant message 会嵌入产生它的精确紧凑 provider stream；`assistant/attempt`、边界与其他仅日志事件从不产生消息。

### 读取日志

`session.seq` 无需物化数组即可读取当前日志长度，`session.eventAt(seq)` 按序列号读取单个已接受且深度冻结的事件。`session.snapshotEvents(fromSeq?, toSeqExclusive?)` 会物化半开区间的冻结稳定快照；当前完整快照会缓存到下一次追加。只需要长度或单个事件的调用方使用 `seq` 或 `eventAt()`。

会话日志位置使用两种数字类型。`SessionSeq` 标识已有事件或包含端点的事件水位；`SessionLogOffset` 标识间隙、前缀长度或读取边界，并且可以等于事件数量。`SessionSeqCursor` 添加 `-1` 这个“尚无事件”值，`OptionalSessionSeq` 则在缺失本身属于数据时使用 `null`。构造函数会校验非负安全整数，品牌在运行时会被擦除，因此持久 JSON 与 wire 值仍是普通数字。

### 派生会话的 fork

`ctx.sessions.fork(source, boundary?, childSessionId?)` 选取截至 `boundary` 事件序号（含该事件）的源事件（默认：当前最后一个事件），要求所选前缀结束时没有开放轮次，再创建带谱系元数据的实时子会话。必须在轮次中途分支的工具时委派会裁剪到已完成前缀。

逻辑 `SessionHeader.isSeeded` 字段报告是否存在 fork 历史，而不公开位置整数。`Session.inheritedEventCount` 保留经过校验的精确 `SessionLogOffset`；`ownEvents()` 返回从该切点开始的事件，`isOwnSeq(seq)` 只接受已存在且由 child 拥有的位置。底层带 seed 构造必须显式提供 `seed` 与 `inheritedEventCount`，因为构造 seed 可以在继承前缀之后包含 child 自有的设置事件。

### 刷新持久状态

`ctx.sessions.flush(session)` 分发需等待完成的持久性检查点：每个持久化监听器都会刷新，调用在所有监听器结算后完成。需要立即持久性屏障的生产方应等待它，而不是假定写后刷新已完成。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释该包如何实现上述行为；可观察约定已在[使用本包](#use-this-package)中完整说明。

### 设计理念

该包建立在事件溯源之上：`Session` 是类型化 `SessionEvent` 的仅追加日志，其他一切——模型历史、transcript、遥测、标题、持久化——都从这条流派生。surface 是派生投影：一个增量管理器校验追加候选、根据已提交事件推进有序视图，并跟踪每次已提交重写都会递增的 `replaceGeneration`。模型可见即已记录：任何到达模型请求的内容都必须能从日志重建。每个到达 settlement 的模型 attempt 都会提交一个事件：`assistant/message` 携带组装后的模型可见 message 及其紧凑带时间 stream，`assistant/attempt` 则保留失败、重试、取消或 stream error attempt，且不添加模型历史。如果进程在 settlement 前硬中断，则不会留下持久 attempt stream。

### 请求 header

`request/header` 存储非历史请求 envelope 的完整规范快照，原因为 `initial`、`resume`、`change` 或 `series`。显式消息序列起点或表层替换会在 envelope 不变时写入 `series` 快照；同时发生变化时使用 `startsSeries: true`。同一序列内的步骤、重试与普通后续轮次继承最新快照。`adapterDefaults` 区分由适配器解析的值与显式设置，`foldRequestHeader()` 选择最新快照。这种自包含记录以每个消息序列增加存储为代价，支持局部窗口渲染与精确重建；细节由[可重建请求 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.zh.md)负责。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`SessionStore` 服务、存储生命周期、`fork`、`flush` |
| [`src/types.ts`](src/types.ts) | `SessionEventMap`、`SessionEvent`、`UserMessage`、`SessionHeader`、`TurnEndReasonMap` |
| [`src/surface.ts`](src/surface.ts) | 有序 surface 投影、替换校验、`deriveEventMessage` |
| [`src/request-header.ts`](src/request-header.ts) | `request/header` 折叠与重建 |
| [`dsh-util-values`](../../util/values/README.zh.md) | 共享无损 JSON 校验与分离式快照 |
| [`src/repair.ts`](src/repair.ts) | 崩溃遗留日志的冷修复 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式配套：序号、轮次／步骤闭合、工具调用／结果配对 |

### 追加校验

每次追加都会使用共享的迭代式 `snapshotJsonValue()` 流程，对每个嵌套值只读取、校验并复制一次，因此有状态的 getter 无法给校验提供一个值、给存储提供另一个值。非无损 JSON 载荷（BigInt、循环、稀疏数组、`-0`、特殊原型）会在追加位置被拒绝，先于任何后端刷新。追加路径会构造每个 `SessionSeq`；surface 事件还会校验标记形态、被引用的源事件序号，以及替换的完整遮蔽节点覆盖。

### 派生历史

`deriveMessages()` 把每个 surface 节点的投影缓存一次，每次调用都返回共享、深度冻结消息之上的新数组；四种 surface 事件类型（`system/message`、`user/message`、`assistant/message`、`tool/result`）各自投影自己的消息种类——渲染后的提示词、user 内容原样、带提供方与模型的组装 assistant 消息，或一等的 tool 角色结果。内容为空的 `system/message` 保留其受保护的 surface 位置，但不投影任何消息。嵌入式 Assistant stream 与 `assistant/attempt` 事件只保留重放和诊断数据。surface 重写会重建投影——不存在原始日志回退，因此 surface 是派生历史的唯一来源。

不替换节点而改变既有消息内容的插件，在 `SessionEventMap` 中用 `@messageProjection` 声明其事件，并通过 `ctx.sessions.registerMessageProjection()` 注册纯处理器。Session 在接受事件前调用该处理器、缓存其不可变消息更新，并推进 `surface.contentGeneration` 以重建派生历史。日志中存在此类事件而未注册处理器时读取会被拒绝，恢复与独立折叠同理，因此 `foldSurface(events, projections)` 与 `Session.create(..., projections)` 必须显式传入处理器。无法访问运行时的独立读取方使用已安装的 `@deepseek-ai/dsh-session-format-catalog/message-projections` 装配。

### 请求头

循环在每个循环实例边界及变更时记录完整规范 `request/header` 快照（调用配置、适配器默认值、渲染后的系统提示词、组装后的工具 schema）；`foldRequestHeader(events)` 通过选择最新快照来重建它，使每个对话请求都成为日志的纯函数。提示词属于派生历史——surface 节点 0——快照里的 `system` 字段则是 `@persistenceReserved`：已发布的 V2 文件把提示词存在那里，因此循环会把它与 surface 节点一起写入，而当前代际读取的是节点。路由元数据（`request/context`）是独立的已记录状态，仅在提供方、模型或容量变化时追加。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

包级约定对大多数消费方已经足够；需要周边领域时再阅读以下页面。

- [会话子系统](../../../docs/subsystems/session.zh.md)——完整事件词汇、surface 类型与生成的服务 API。
- [持久化子系统](../../../docs/subsystems/persistence.zh.md)——后端如何让该日志持久化。
- [Core 子系统](../../../docs/subsystems/core.zh.md)——写入并派生会话的循环。
- [生成持久化目录](../../../docs/persistence-catalog.zh.md)——每个会话事件及其载荷与声明位置。
- [core 分组地图](../README.zh.md)——core 各包如何组合。

-----

<a id="model-experience"></a>
## 模型体验

### 派生消息历史

#### 模型看到什么

模型会原样接收 `user/message`、`assistant/message` 与 `tool/result` surface 条目中的完整消息——标识、角色、来源与内容块都与创建时确定的值相同，投影从不生成标识。直接提示词与注入上下文仍是彼此独立的 `user/message` 事件，各事件的来源会保留其出处。嵌入式 stream、`assistant/attempt`、边界与其他仅日志事实不会添加消息。

#### Token 影响

追加的 surface 条目会在后续步骤中重新发送。`replace` surface 操作会从未来输入中移除被遮蔽条目，但不删除其原始日志记录。

#### KV Cache 影响

追加的 surface 条目会保留可复用前缀。即使底层事件日志保持仅追加，`replace` 操作也会从首条被遮蔽消息起使缓存复用失效。

### 未应答工具调用的恢复

#### 模型看到什么

如果恢复发现 assistant 工具请求没有持久 `tool/call`，其合成 `TOOL_NOT_STARTED` 结果内容为 `The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.`。如果持久 `tool/call` 没有结果，其 `TOOL_OUTCOME_UNKNOWN` 结果内容为 `The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.`。

#### Token 影响

每个已请求的调用都有持久结果时，token 增量为零。活步骤在 `step/end` 之前失败，以及崩溃后的恢复，都会为每个未应答的调用追加一条错误结果。

#### KV Cache 影响

保持仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 已记录的请求头

#### 模型看到什么

会话会重建循环实际发送的系统提示词、工具 schema、调用配置与会话前缀。提示词就是派生的首个 `system/message` 节点，而不是在 `deriveMessages()` 外部前置的第二份副本。

#### Token 影响

日志记录不产生重复 token。重建的前缀、系统文本与 schema 仍会产生正常的逐请求开销。

#### KV Cache 影响

记录日志不会导致失效，精确重建会保持请求前缀一致。后续请求头若更改前缀、提示词或 schema，可能从第一处差异开始使复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明会话存储何时需要特别留意。它们是当前包约束，不是任务积压。

- **`fork()` 仅在实时会话的稳定边界处切分**：所选前缀结束时不得有开放轮次，且源会话必须位于存储中；[fork API](../../../.agents/notes/implemented/feature/2026-06-30-session-store-fork-api.zh.md) 不支持对已持久化但未加载的会话进行 fork。
- **`SESSION_FORMAT_VERSION` 只命名当前逻辑表示**——历史 header 与事件位于相邻格式包中，持久化会在构造 `Session` 前发布完整受支持链；同版本未知事件仍要求信封显式带有 `ignorable` 标记（[机制](../../../.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.zh.md)）。
- **`TurnEndReasonMap` 不含 ACP（Agent Client Protocol）命名的 `refusal`／`max_turn_requests` 变体**：受生产方约束；只有当适配器或循环首次产生这些变体时才加入。
- **fork 之外没有会话树**：基于分支会话的 pi 风格条目树被推迟，除非消费方需要超越基于边界的 forking 的能力。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
