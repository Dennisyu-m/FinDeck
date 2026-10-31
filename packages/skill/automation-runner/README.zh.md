---
description: "FinDeck 流水线与值班任务共用的宿主调度器。一个计时器和一张在途表同时服务两层；两层各自通过自己的 Loader 行登记/注销任务集，不注册模型工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-automation-runner

[English](README.md) | 中文

## 概述

`dsh-automation-runner` 是流水线与值班任务共用的宿主调度器。它只拥有一个计时器和一张在途表，不自己读取任何一种任务源：`@deepseek-ai/dsh-automation-runner/pipeline-scheduler` 读取 `finance/pipelines/*.yaml` 并调用 `setPipelineTasks`，`@deepseek-ai/dsh-desk` 读取值班任务并调用 `setDeskTasks`。流水线到点经 `ctx.subprocess` 执行 `python -m findeck.pipeline run <path>`；值班到点先执行 `python -m findeck.desk run <path>`，再起一个受任务 `budget` 约束的 `dsh --profile desk` 会话。`list`、`runNow`、`setPipelineTasks`、`setDeskTasks`、`runDeskTask`、`cancelDeskTask`、`isDeskRunning` 是宿主 API。本插件不注册模型工具、提示词段落或会话事件。

## 目录

- [使用本包](#使用本包)
- [Model Experience](#model-experience)
- [已知限制与延后工作](#已知限制与延后工作)

-----

<a id="使用本包"></a>
## 使用本包

挂在已经提供 `ctx.subprocess` 的长期宿主上。随附的 base bundle 就是这样挂的。headless、sdk、acp 把这一行设为禁用，因为活着的计时器会拖住那些一次性进程，使它们无法退出。Web 组合里执行器始终挂着：定时任务开关只卸 `pipeline-scheduler` 行，值班开关只卸 `@deepseek-ai/dsh-desk`/`ui-desk` 行，互不连带。

```yaml
- id: automation-runner
  name: '@deepseek-ai/dsh-automation-runner'

- id: pipeline-scheduler
  name: '@deepseek-ai/dsh-automation-runner/pipeline-scheduler'
```

### 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `tasksDir` | `<harness 家目录>/desk/tasks` | 值班任务 yaml。目录不存在时不加载值班任务。相对路径按 `repoRoot` 解析。运行记录写在同级的 `runs` 目录。 |
| `repoRoot` | 包含本包的仓库 | `python -m findeck.pipeline run` 的工作目录。 |
| `pythonPath` | 当前操作系统对应的 `finance/python/.venv` 解释器 | 相对路径按 `repoRoot` 解析。 |
| `assetDir` | `<harness 主目录>/asset-library` | 以 `FINDECK_ASSET_DIR` 传给子进程。相对路径按 harness 主目录解析。 |
| `timeoutMs` | `1800000` | 一次流水线进程的墙钟预算。到期会中止子进程，并与退出码分开记录。 |
| `catchUp` | `latest` | 启动时只补最近一次错过的触发。`none` 则等到下一次未来触发。 |
| `stderrTailBytes` | `8192` | 写进运行记录的 stderr 字节数。 |
| `graceMs` | `15000` | abort 之后交给 `ctx.subprocess` 的宽限。 |

`pipeline-scheduler` 行接受 `pipelinesDir`（默认 `<仓库>/finance/pipelines`，相对路径按仓库根解析）。目录不存在、yaml 不符合下面的触发规则、或 Croner 拒绝 cron 表达式，会让这一行加载失败，但不影响执行器本身。

### 触发

`manual` 会出现在列表里，也可以 `runNow`。它不会被武装。

`cron` 是宿主本地时区的五段表达式：`{ kind: cron, schedule: "0 17 * * 1-5" }`。

`interval` 是正整数秒：`{ kind: interval, everySeconds: 3600 }`。起点是 `pipeline-runs` 最新一行的时间戳。没有记录的文件会先等满一个间隔再首次触发。

### 运行记录

每次触发在子进程退出后向 `<assetDir>/pipeline-runs/<name>.jsonl` 追加一行。这一行保留 Python 步骤记录的键（`ts`、`pipeline`、`step`、`status`、`produced`、`inputs`、`duration_s`），并新增 `exitCode`、`timedOut`、`signal`、`stderrTail`。Python 自己写的步骤行不会被改写。`status` 为 `ok`、`failed` 或 `skipped`。同一名字已有进程在跑时（包括重载尚未等上一个进程退出），记为 `skipped`，不再 spawn。失败不重试；下一次触发是下一个未来时点。

`catchUp: latest` 在启动时每个任务最多补一次错过的时点，更早的错过不回放。

卸载时先把运行器标为关闭，abort 在途子进程，等到这些子进程退出，再清掉计时器。

值班运行在取消、任务被移除或卸载已经执行时，状态记为 `cancelled`，即使墙钟也已到期或子进程退出码非零；`timedOut`、`exitCode` 与 `cancelled` 同时保留在记录上。没有取消标记的非零退出仍是 `failed`，只有墙钟到期才是 `timeout`。取消会中止当前子进程，运行记录在该子进程退出后写下；之后不再启动模型子进程，也不再启动无解读版归档；创建归档临时目录期间到来的取消同样不会进入 `sandbox.confine`。已经归档的报告保留。墙钟在模型子进程开始前到期时，仍会在 `archiveTimeoutMs` 内归档无解读版。

### 宿主 API

`ctx.automationRunner.setPipelineTasks(files)` 替换整组流水线；移除的在途流水线会中止。关掉定时任务层会卸载 `pipeline-scheduler` 行并调用 `setPipelineTasks([])`，值班层仍保持武装。`ctx.automationRunner.list()` 返回流水线与值班两类的名字、种类、触发、下次触发和最新运行行。

`ctx.automationRunner.runNow(name)` 立刻运行该任务。未知名字会抛错。

-----

<a id="model-experience"></a>
## Model Experience

没有。本插件不注册模型工具、提示词段落或会话事件。

#### KV Cache effect

运行器不发起模型请求，也不写会话事件，因此不会改动可复用的前缀。

## 已知限制与延后工作

<a id="已知限制与延后工作"></a>

- **值班到点先算信号，再起一个 desk 会话** — `python -m findeck.desk run` 写下信号，然后 `dsh --profile desk` 读这一行。`budget.wallSeconds` 到点中止整次运行。`event` 与 `thesis-due` 由值班服务负责武装并调用 `runDeskTask`；执行器本身只武装 cron 与 interval。定时任务页只列出流水线。
- **没有事件触发** — 执行器不接收 webhook 投递；值班服务通过 `ctx.webhookRuntime` 注册规则。被执行器武装的触发只有 cron 与 interval。
- **间隔的起点是最新运行行** — 没有记录的任务不补跑，而是等一个间隔。`ts` 不是时间戳的行会让加载失败。
- **加载时读一次 jsonl** — 最新一行是文件最后一条非空行，只在插件加载时读。本进程之后追加的行只更新内存快照。
- **一次性 profile 上禁用** — headless、sdk、acp 随附配置把该行禁用。在那些 profile 上启用它，只要计时器还武装着，进程就不会退出。
- **来源记录由宿主工具负责** — 值班子进程只记录成功 `asset_show`/`asset_run` 解析出的确切版本；归档没有收到 `--sources-file` 时标为 `sourcesComplete: false`，不猜版本。
- **无解读版归档走沙箱** — 值班会话没有归档报告时，执行器用 `ctx.sandbox` 把 `python -m findeck.desk archive-report --no-record` 限制为只能写资产库，再由宿主把返回的报告行追加到值班运行日志。缺少 sandbox 服务时拒绝归档，不改为不受限写入。Windows backend 只限制文件写入，不是程序白名单，也不隔离读取或网络。这次归档使用单独的 `archiveTimeoutMs`，不占用本次运行的墙钟。
- **关闭定时层不补跑** — `catchUp: latest` 只对进程内第一次流水线登记生效；开关重新打开从下一个未来触发开始。
