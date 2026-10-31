# FinDeck 模型接入配置

FinDeck **不内置任何密钥**——每个用户接入自己的模型。三种方式，从简到繁。

## 方式一：Web UI 填 key（推荐，最简单）

1. 启动 FinDeck——Windows 用仓库根目录的 `start-findeck.ps1`（见下文「数据目录（home）与端口」），其它平台用 `pnpm dsh web`——然后打开 http://127.0.0.1:3081（FinDeck 默认端口，与原版 dsh 的 3080 区分）
2. 进入 **设置（Settings）→ 模型（Models）**
3. 在 **DeepSeek 卡片**里粘贴你的 DeepSeek API key（到 platform.deepseek.com 申请），保存
4. 想用其他厂商：点 **添加提供商**（OpenAI / Anthropic 等，填对应 key）或 **添加自定义提供商**（任意 OpenAI 兼容网关）

密钥是只写的：保存后界面只显示脱敏描述，明文存放在 `~/.findeck/.credentials.yaml`。

## 方式二：环境变量（适合服务器/无界面环境）

DeepSeek 适配器默认读取环境变量 `DEEPSEEK_API_KEY`：

```bash
# Linux/macOS
export DEEPSEEK_API_KEY="sk-你的key"
# Windows PowerShell
$env:DEEPSEEK_API_KEY = "sk-你的key"
```

也可以写进项目根目录或用户主目录的 `.env` 文件（启动时自动加载）。

## 方式三：配置文件（完全模板化，复制即用）

模板在 [`config-examples/`](config-examples/) 目录。复制到 harness 主目录后填空：

| 文件 | 放到哪里 | 作用 |
|---|---|---|
| `settings.example.yaml` → `settings.yaml` | `~/.findeck/settings.yaml` | 配置提供商路由（哪个网关、哪些模型） |
| `credentials.example.yaml` → `.credentials.yaml` | `~/.findeck/.credentials.yaml` | 存放 key 明文 |

### 场景 A：DeepSeek 官方 API

```yaml
# ~/.findeck/settings.yaml —— 通常不用写任何内容，默认即走官方路由，
# 只需把 key 放进 ~/.findeck/.credentials.yaml：
DEEPSEEK_API_KEY: sk-在这里填你的key
```

需要自定义时（如私有代理地址）：

```yaml
llm-deepseek:
  apiKeyEnv: DEEPSEEK_API_KEY
  baseURL: https://api.deepseek.com   # 留空用官方地址
```

### 场景 B：任意 OpenAI 兼容网关（中转站/公司网关/智谱GLM/月之暗面等）

```yaml
# ~/.findeck/settings.yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: MY_GATEWAY_API_KEY        # 指向 credentials 文件里的字段名
      api: openai-completions
      baseURL: https://你的网关地址/v1
      models:
        - id: 模型ID                        # 例如 glm-4.7、kimi-k2 等
```

```yaml
# ~/.findeck/.credentials.yaml
MY_GATEWAY_API_KEY: 在这里填你的key
```

### 场景 C：本地模型（Ollama / LM Studio / vLLM 等）

本地推理服务普遍暴露 OpenAI 兼容接口，按"自定义提供商"接入即可：

```yaml
# ~/.findeck/settings.yaml —— 以 Ollama 为例（默认端口 11434）
llm-pi-ai:
  providers:
    local-ollama:
      api: openai-completions
      baseURL: http://127.0.0.1:11434/v1
      models:
        - id: qwen3:32b
        - id: deepseek-r1:32b
```

本地服务通常不校验 key，credentials 文件里可以随便填一个占位值（但字段要存在）：
`LOCAL_OLLAMA_API_KEY: local-no-key`

## 验证

配置完成后在 Web UI 顶部的**模型选择器**里应能看到你的模型；发一条消息测试。改动配置即时生效（无需重启）。

## 数据目录（home）与端口

FinDeck 的全部持久数据都在**一个** harness home 下：`sessions/`、`settings.yaml`、`.credentials.yaml`、`.anonymous-user-id`、`profiles/`、`projects/`（项目目录，每个工作区 `<home>/projects/<workspace-id>`）、`default-workspace/`、`attachments/`、`storages/`（KV 域）、`roundtables/`（圆桌归档）、`asset-library/`（研究资产库）、`memory/`（工具记忆的全局库，首次写入时创建）、`.agent-presets/`（用户自撰的 agent preset 根，可选）、`llm-deepseek/`（上传文件索引）、`desktop/`（桌面壳窗口状态）、`logs/`（启动脚本与服务日志）等。解析顺序（高到低）：

1. 代码里显式传入的 home；
2. 环境变量 `FINDECK_HOME`（FinDeck 自己的变量）；改名前的 `ALPHADECK_HOME` 仍作兼容别名，二者都设时 `FINDECK_HOME` 优先；
3. 环境变量 `DSH_HOME`；
4. 默认 `~/.findeck`。

默认根目录随产品一起改名：首次解析默认 home 时，若 `~/.findeck` 不存在而 `~/.alphadeck` 存在，会把后者整目录改名为前者（同卷 `fs.rename`），因此就地升级不会丢会话、设置与圆桌归档。只有默认 home 会被迁移；`FINDECK_HOME` / `ALPHADECK_HOME` / `DSH_HOME` 指定的目录不动。

原版 DeepSeek Harness 会把它自己的 `DSH_HOME=~/.dsh` 导出给每个它启动的 shell。若 FinDeck 在这样的 shell 里被启动（常见于从原版终端或运行在原版里的 agent 手动重启服务），继承来的 `DSH_HOME` 会把两边的会话、设置和圆桌归档写进同一个根目录。因此 **`DSH_HOME` 指向原版默认目录 `~/.dsh` 时会被忽略**，并在 stderr 打印一行提示；真要共用该目录，请显式设 `FINDECK_HOME=~/.dsh`。

Windows 请始终用仓库根目录的启动脚本，它会固定 home 并接管 3081 端口：

```powershell
# 桌面快捷方式 "fin" 等价于此
powershell -NoProfile -ExecutionPolicy Bypass -File start-findeck.ps1
```

脚本把 `FINDECK_HOME` 和 `DSH_HOME` 都固定为 `~/.findeck`，并把启动的进程号记在 `~/.findeck/logs/web-server.pid`；3081 上若不是它自己启动的进程（或日志里的 token 已失效），会先停掉再重新拉起，所以从别处启动的“串味”服务只要重跑一次脚本就会被纠正。原版 DSH 的 3080 与 `~/.dsh` 不受影响。

## 自动化与会话提醒

「设置 → 自动化」提供两个独立开关：定时任务默认开启，由宿主执行 `finance/pipelines/*.yaml` 中声明的任务；值班默认关闭，开启后提供任务管理、运行记录与报告页面。关闭一层不会停止另一层；Work 模式始终可用。值班需要可用的模型配置和金融 Python 环境，配置方法见上文及 [金融层说明](finance/README.zh.md)。

会话提醒（Schedule）在出货的 Web 组合里已经可用：`ui-pages` 注册的「会话提醒」页（`settings.section` id `schedule`）列出已排定提醒与过期状态，并给出可复制的常用模板；模型侧的 `schedule_create` / `schedule_list` / `schedule_delete` / `schedule_pause` / `schedule_resume` 五个工具随 base 的 `schedule` 行挂载。提醒的持久状态是会话自己的 `schedule/change` 事件流，投递只到打开着的会话——没有外部通道，会话关着时不触发，会话再次打开时按日志补投已到期的提醒；会话头部的活动提醒目录 `ui-schedule` 在出货组合里是 `disabled: true`。

base 把 `path: ':memory:'` / `openAt: never` 写在 `schedule` 行下，但 `dsh-schedule` 不导出 `Config`，Loader 对没有配置 schema 的插件原样透传配置，它的 `apply(ctx)` 也不读配置，因此这两个键不配置它；同一组键在出货组合里由 web-app 层挂在 `session-query-sqlite` 行上，其 `openAt: never` 关闭会话内容检索、完全不打开 SQLite 索引，`ctx.sessionQuery` 的精确读取、标题与血缘查询照旧可用。

叠加层由 `--patch` 引入，可重复，按 argv 顺序在每个 profile 层之后生效；`$DSH_HOME/cordis.patch.yml` 是同一套机制的常驻层，用于长期调整。`apps/cli/config/examples/schedule/cordis.yml` 就是一个叠加层：base 已经有 `id: schedule`，所以示例只 `insert` 一行 `time-context`（浏览器时区解析），并把 `ui-schedule` 置为 `disabled: false`。无 patch 级 id 的 `insert` 是无条件追加，既不去重也不替换既有行；再插入一行 `schedule` 会在加载插件树时以 `duplicate loader entry id: schedule` 失败。

启用会话头部的提醒目录：

```powershell
pnpm dsh web --patch apps/cli/config/examples/schedule/cordis.yml
```

只看合成结果而不启服务：

```powershell
pnpm dsh web --dump-config --patch apps/cli/config/examples/schedule/cordis.yml
```

Windows 的 `start-findeck.ps1` 只接受 `-NoBrowser` / `-Port`，不接受 `--patch`，因此叠加层只在直接跑 `dsh web --patch` 时生效。

用户自撰的 agent preset 放在 `<home>/.agent-presets`（home 的解析同上，Windows 默认即 `~/.findeck/.agent-presets`）。`dsh-agent-presets` 默认把该根作为用户层纳入名册，因此放进去的 preset 会出现在会话的 preset 选择器里；同名时随包内置的 shipped preset 优先。首次保存时该目录自动创建。

## 常见问题

- **key 填了但请求 401**：确认 `apiKeyEnv` 指向的名字和 `.credentials.yaml` 里的字段名完全一致，或直接用环境变量方式。
- **网关报 `max_tokens`/`developer role` 不支持**：部分 OpenAI 兼容网关不认新字段，在提供商路由下加：
  ```yaml
      compat:
        supportsDeveloperRole: false
        maxTokensField: max_tokens
  ```
- **想看全部可配项**：读生成的配置参考 `docs/config-catalog.md`（上游文档）。
