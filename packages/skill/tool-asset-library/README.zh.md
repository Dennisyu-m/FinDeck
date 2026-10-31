---
description: "面向模型的 FinDeck 资产库工具：发现、检索、查看、并在金融 Python 环境内复用已归档的研究资产。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-asset-library

[English](README.md) | 中文

## 概述

研究会话会留下可复用的产物——训练出的模型、下载的权重、计算模块——归档在用户的全局 FinDeck 资产库里。本消费方包为每个 agent 提供七个工具：`asset_dir` 报告库根目录，`asset_list` 汇总资产与验证指标（可用 `query` 对名称/描述/依赖做不区分大小写的子串过滤、用 `kind` 只看一类），`asset_search` 按结构化条件（query、kind、origin、tag、verb、dependency）检索资产并返回每个命中的路径，`asset_show` 返回某个资产的 manifest、文件清单和代码预览，`asset_graph` 返回单个资产的传递依赖闭包与反向依赖者，`asset_run` 在金融 Python 虚拟环境内执行资产入口函数并走审批接缝，`asset_run_bg` 把一个 verb 提交成后台 run 并在被接受后立即返回。首次请求前，agent 还会收到一份持久资产目录，罗列全部可用资产——通过与 skill 目录共用的会话目录机制发布。资产库的目录布局与 `manifest.yaml` 格式由 `finance/python/findeck/assets.py` 拥有；本包只读取该模块每次归档后重建的机器可读 `index.json`——索引版本 2 的条目新增 `origin`、`verbs`、`freshness`、`lineage`、`tags`、`face` 六个字段，版本 1 的条目按这些字段的缺省值读取。每次 `asset_search`、`asset_show`、`asset_run`、`asset_run_bg` 成功调用都会向 `<assetDir>/usage.jsonl` 追加一行——库的命中率与活物率统计即由该调用日志计算。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载本插件即可让 agent 发现、查看并复用已归档的研究资产。它要求 `ctx.tools` 与 `ctx.subprocess`；`asset_run` 另外会咨询 `ctx.approval`（机会式——未组合审批服务时安全失败），`asset_run_bg` 在组合了 `ctx.roundtable` 时把被接受的 run 报给圆桌引擎（机会式——没有该服务时照样提交 run，记录留在磁盘上）。

### 何时选择

在 FinDeck 组合中使用：会话训练模型、沉淀可复用计算，后续会话应能复用。不挂载时资产库仍可经 Python 的 `findeck.assets` 模块使用，只是没有工具和目录暴露给模型。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-tool-asset-library'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `assetDir` | `<harness 主目录>/asset-library` | 资产库根目录：配置的主目录、`$DSH_HOME`，否则 `~/.findeck`；与 Python 侧 `FINDECK_ASSET_DIR` 对应 |
| `pythonPath` | 仓库的 `finance/python/.venv` 解释器 | `asset_run` 与 `asset_run_bg` 使用的金融 venv |
| `requireApproval` | `true` | `asset_run` 执行前是否必须通过审批接缝；`asset_run_bg` 从不询问，因为它只提交后台工作、返回时还没有任何结果 |
| `maxOutputBytes` | `262144` | 单次 `asset_run` / `asset_run_bg` 每条流的输出采集上限（字节） |
| `graceMs` | `15000` | `asset_run` / `asset_run_bg` 子进程的终止宽限（毫秒） |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-asset-library)是全部可接受字段的权威来源。

### 模型得到什么

- **会话资产目录。** 存在资产且 `asset_list` 工具可见时，agent 在首次请求前收到一条持久 user 角色消息，罗列每个资产的名称、类型、最新版本与描述，并指向三个工具的用法。
- **发现与查看工具。** `asset_list` 返回每个资产的摘要（含验证指标与依赖资产），可按 `query`/`kind` 过滤；`asset_search` 返回满足 `query`、`kind`、`origin`、`tag`、`verb`、`depends_on` 任意 AND 组合的资产摘要与版本目录路径；`asset_show` 返回某个版本的 manifest、文件清单与 Python 代码预览；`asset_graph` 走依赖图——向前的传递闭包（缺失名称标注）与全部反向依赖者，逐级依赖按其最新版本行走；`asset_dir` 报告库根目录。
- **venv 内执行。** `asset_run` 解析版本目录、通过审批接缝，经 subprocess Service Definition 在金融 venv 内运行资产入口函数，返回采集到的 stdout 与驱动的结果负载。
- **后台提交。** `asset_run_bg` 解析资产的最新版本，在金融 venv 内分离启动 `findeck.verb_bridge --background`，并在桥接受请求后立即返回 `{ run_id, record_path, asset, verb, status: 'running' }`——verb 本身继续跑，把结果写进 `<assetDir>/runs/<run_id>.json`。它不走审批接缝；组合了圆桌引擎时会登记这条 run，让提交它的发言者在回合边界拿到结果。

### 可观察的成功与失败

`asset_run` 成功返回 `{ stdout, result_json }`。未知的资产或版本会列出可选项；venv 缺失时提示运行 setup 脚本；manifest 声明但 venv 未装的依赖以清单形式报告、绝不自动安装；审批服务缺失或用户拒绝时拒绝执行。所有失败都形如 `Error: <message>`。

`asset_run_bg` 成功时返回 run 的 id 与记录路径，此时 run 仍在执行。库索引读不出来或资产名未知时它在启动前就拒绝；提交本身失败时报出桥的消息；分离 run 内部的失败在这里看不到——它落进 run 记录成为 `status: 'error'`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节说明工具与目录的构建方式；可观察行为见[使用本包](#use-this-package)与下方模型体验。

### 设计概念

Python 模块拥有库格式；本包拥有模型边界。桥梁是每次归档后重建的 `index.json`，作为持久文件边界做防御式解析——读不懂的索引按"库不存在"报告，而不是当成另一个库；不支持的索引版本判定文件无效；版本 2 的字段出现但类型不对同样判定无效。版本 1 保持可读：其条目解析为 `origin` 与 `face` 未设置、`verbs`/`tags` 为空、`freshness`/`lineage` 为 null。目录驱动 `@deepseek-ai/dsh-skill` 的 `publishSessionCatalog`，即与 skill 目录共用的发布判定：基于持久条目的摘要、精确工具可见性、整表替换消息。

### 调用日志

每次 `asset_search`、`asset_show`、`asset_run`、`asset_run_bg` 成功调用都会向 `<assetDir>/usage.jsonl` 追加一行 JSON：`{ts, tool, asset?, session?}`——库级检索没有 `asset`，调用不属于任何 agent 时没有 `session`。首次记录时该文件（连同其目录）会被创建。记录是旁路通道：目录无法创建或不可写只会让统计信息过期，绝不会让工具调用失败。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：七个工具注册、目录 pre-step 监听器、使用日志、驱动协议、后台提交 |
| [`src/types.ts`](src/types.ts) | 索引/来源形状与 `asset-library-catalog` 消息来源合并 |
| — | 不发布运行时 invariant 伴生包；本模型侧适配器没有独立生命周期流；执行关系由它调用的 subprocess、审批与圆桌接缝拥有。 |

### 驱动协议

`asset_run` 以版本目录为 cwd 生成 `<venv-python> -c <driver> <版本目录> <entry> <args-json>` 并采集 stdout/stderr。venv 内的驱动加载 `manifest.yaml`，声明依赖在 venv 缺失时以清单拒绝（绝不自动安装），导入资产的 `.py` 文件，用解码后的关键字参数调用入口，并在标记行后打印 JSON 结果；退出码 `3`/`4` 区分缺依赖与驱动错误。

`asset_run_bg` 以资产的版本目录为 cwd 生成 `<venv-python> -m findeck.verb_bridge --background <请求 JSON>`。桥启动分离的 run、打印一行命名该 run 的 JSON 后退出；工具从这一行读出 run id，按 `<assetDir>/runs/<run_id>.json` 拼出记录路径，并在组合了圆桌引擎时把它交给引擎。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-asset-library)——模型收到的确切 schema。
- [`finance/python/findeck/assets.py`](../../../finance/python/findeck/assets.py)——本包消费的库布局、manifest 契约与归档校验。
- [tool-skill 包](../tool-skill/README.zh.md)——本包目录所镜像的会话目录生命周期。

-----

<a id="model-experience"></a>
## 模型体验

### 会话资产目录

#### 模型看到什么

存在资产且本插件注册的 `asset_list` 精确可见时，agent 在首次请求前收到下方模板的持久 user 角色消息。库变化时以相同 `<available_assets>` 信封追加完整替换。

##### 资产目录模板

```markdown
<system-reminder>
Reusable research assets from this user's FinDeck asset library are available:

<available_assets>
- `<name>` (<kind> v<version>): <normalized-and-capped-description>
</available_assets>

Call `asset_list` for validation metrics and dependencies, `asset_show` to inspect an asset's manifest and code, and `asset_run` to execute an asset entry in the finance Python environment. Assets are versioned; calls default to the latest version.
</system-reminder>
```

#### Token 影响

成本随资产数量与截断后的描述（240 字符）增长；库为空或不存在时不发送任何内容。

#### KV Cache 影响

持久目录追加在可复用前缀之后；替换消息是其后的追加历史，更早的可复用 token 不受影响。

### 工具 schema

#### 模型看到什么

模型看到生成的 [`asset_dir` / `asset_list` / `asset_search` / `asset_show` / `asset_graph` / `asset_run` / `asset_run_bg` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-asset-library)。

#### Token 影响

工具可见的请求有固定 schema 成本。

#### KV Cache 影响

工具定义与可见性不变时前缀稳定。

### 工具结果与错误

#### 模型看到什么

`asset_run` 成功渲染 `asset_run <name> → <结果负载>`；失败渲染 `asset_run <name> failed: <错误>`。`asset_run_bg` 成功渲染 run id 与它的记录路径。其余工具以文本渲染摘要与 manifest。

#### Token 影响

数据相关的工具结果 token，重发直至压缩；`code_preview` 上限为两个文件 × 1200 字节。

#### KV Cache 影响

只追加；新可见内容位于可复用请求前缀之后。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

这些限制说明何时不适合使用本工具。它们是当前包的约束，不是任务清单。

- **入口发现会导入所有顶层 `.py` 文件**——模块级代码有副作用的资产会先执行副作用；该行为由资产自己负责。
- **无流式或部分结果**——`asset_run` 是批处理：采集输出有上限，溢出尾巴不进入工具结果。
- **目录是整表替换**——归档或删除一个资产就重发全部条目；摘要机制保证未变化的库零成本。
- **模型资产必须附带暴露 `predict` 的可运行 `.py`**——纯权重不可执行；研究 skill 中的归档纪律拥有该契约。
- **`asset_run_bg` 不报告完成**——它只回答被接受的 run id 与记录路径，从不回答结果；想拿回结果的调用方需组合圆桌引擎（由它在回合边界跟读记录），或自己去读 `<assetDir>/runs/<run_id>.json`。记录路径按本包的 `assetDir` 拼出，并且每次启动金融 venv 都会把 `FINDECK_ASSET_DIR` 设成同一个绝对根，覆盖环境里已有的值。它没有审批接缝是刻意的：该工具只提交后台工作，调用时根本还没有结果，它能跑什么由库暴露的资产 verb 界定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
