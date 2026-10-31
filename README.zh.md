# FinDeck

[English](README.md) | 中文

**FinDeck** 是一个 AI 主导的金融研究 harness——AI 是研究员，FinDeck 是它的驾驶舱，你是随时可以接管的副驾驶。

它基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT，"一切皆插件"的开源 Agent 运行时）改造，叠加了一层金融能力：

- **数据，一条命令就位** —— 一个装好 `akshare`（A股/宏观/新闻）、`yfinance`（全球股票/外汇/商品）、`ccxt`（加密货币交易所）、`baostock` 的 Python 环境，由 [`finance/python/setup-env.sh`](finance/python/setup-env.sh) 创建（680 MB 的 venv 本身不入库，新克隆默认没有）。
- **模型，按需安装** —— 不预装任何重型建模库。内置 skill 就是"模型地图"：任务需要线性回归、梯度树、LSTM/Transformer 时序模型或零样本预测（Chronos/TimesFM）时，AI 自己查地图、装包、跑起来。
- **Skill 即手册** —— 十四个金融 skill 教会 AI：每类数据去哪拿、什么任务配什么模型、怎么回测不自欺、研究报告怎么写。
- **AI 主导，人类监督** —— AI 自己决定查哪个数据源、用哪个工具、何时上网搜索；每一步都在 Web UI 里可见、可审批、可打断。

> 开发者预览版——会跟随上游出现不兼容变更。运行前请阅读[安全说明](SAFETY.zh.md)。

> FinDeck 的产出不构成投资建议。运行前请阅读 [SAFETY.zh.md](SAFETY.zh.md)。

## 下载

到 [Releases](https://github.com/Dennisdan1104/FinDeck/releases) 页面下载 Windows 安装包，文件名形如 `FinDeck.Setup.*.exe`。

安装包未签名，Windows SmartScreen 会提示“未知发布者”。这是本版本的预期行为：点 **更多信息 → 仍要运行** 即可。

装好就能直接用桌面版。安装包不内置重型组件——Python 数据环境等大组件在 **设置 → 环境与组件** 里按需下载，不必提前准备。

想从源码构建，或参与 FinDeck 本身的开发，见下方「快速开始」。

## 快速开始

<a id="run"></a>

<a id="run-from-source"></a>

环境要求：Node.js ≥ 22.19（或 ≥ 24）、Python ≥ 3.10、pnpm ≥ 11。

```sh
git clone https://github.com/Dennisdan1104/FinDeck.git findeck && cd findeck
pnpm install
pnpm run build

# finance data environment (required for finance work)
bash finance/python/setup-env.sh          # Windows: powershell -ExecutionPolicy Bypass -File finance/python/setup-env.ps1

pnpm dsh web                              # opens http://127.0.0.1:3081
```

然后接入模型——见 **[CONFIGURATION.md](CONFIGURATION.md)**。密钥永不内置：每个用户填自己的（DeepSeek 官方、任意 OpenAI 兼容网关、或本地推理服务）。

FinDeck 与原版 DeepSeek Harness 安装互不干扰：默认端口 **3081**（不是 3080），数据目录 **`~/.findeck`**（不是 `~/.dsh`），两者可以同时运行。Windows 上请用 `start-findeck.ps1`（或 `start-findeck.vbs`）启动：启动脚本固定 `FINDECK_HOME`，而解析器会拒绝从原版 shell 继承来的 `DSH_HOME=~/.dsh`。详见 [CONFIGURATION.md](CONFIGURATION.md#数据目录home与端口)。

## 对话显示

「设置 → 通用设置」提供一个持久化的四档偏好，控制已完成轮次如何呈现它的过程内容；它存放在 `ui-chat` 命名空间，对所有会话生效。

| 模式 | 作用 |
|---|---|
| **Compact** | 折叠已完成轮次，并在过程组标题里隐藏正在执行的命令、路径或查询详情 |
| **Standard**（默认） | 折叠已完成轮次，并保留标题里的实时详情 |
| **Detailed** | 折叠已完成轮次，只对历史轮次做步骤分组，并保留实时详情 |
| **Verbose** | 不折叠、也不做步骤分组：所有过程行保持可见，不显示轮次过程控件 |

该偏好同时接受旧三档写法：`compact` 保留原名与原义，`grouped` 按固定映射读作 `standard`，`normal` 读作 `verbose`，`expanded` 读作 `detailed`，因此已有的设置文件继续可用；你下一次主动选择时，持久值才会被改写成新档位。

## 内置 skills

| Skill | 教给 AI 什么 |
|---|---|
| `findeck-research` | 总纲工作流：澄清问题 → 拉数据 → 分析 → 建模 → 验证 → 报告 |
| `findeck-market-data-cn` | 中国市场数据（akshare，备选 baostock）：行情/财报/估值/新闻/宏观 |
| `findeck-market-data-global` | 全球数据（yfinance、ccxt）与 FRED 宏观 |
| `findeck-quant-models` | 模型地图：内置工具箱（岭回归/随机森林/LightGBM/ARIMA，统一调参接口）+ 神经网络按需安装指引 |
| `findeck-backtesting` | vectorbt / backtrader 模板、指标解读、未来函数检查清单 |
| `findeck-visualization` | 出图规范：charts 工具箱 + read_image 让图表真正显示在 UI |
| `findeck-factor-analysis` | 因子检验：IC/RankIC、分层回测、共线性、换手 |
| `findeck-portfolio` | 组合构建：等权/最小方差/风险平价/MVO + 绩效评估 |
| `findeck-macro-playbook` | 宏观剧本：美林时钟/利率传导/信用周期/政策跟踪 |
| `findeck-python-env` | 预装环境：解释器路径、pip 镜像、缓存约定、故障排查 |
| `findeck-pipeline` | 资产流水线：`pipeline.yaml` 格式与校验、步骤脚本协议（marker/参数/产物路径）、手动跑法与 harness 定时跑法、失败语义与版本递增纪律 |
| `findeck-asset-face` | 生成资产脸：8 种组件的词汇表、各类资产的好脸规则、存放位置与 manifest 声明、`validate_face.py` 校验 |
| `findeck-workbench` | Work 模式：Work/Free 判定、`workbench.yaml` 格式、开场的资产锚 brief、运行资产并汇报的纪律 |

Skills 位于 [`finance/skills/`](finance/skills/)，是纯 Markdown，通过 harness 的 skill 系统挂载。想加自己的 skill？在那个目录新建一个放 `SKILL.md` 的文件夹即可。

## 五种模式

会话以组合它的 preset 所带的模式启动，之后可随时切换：`/mode <preset id 或名称>`（或输入框里的模式控件）会用目标 preset 重新组合 agent，其工具、skills、提示词段、persona 与沙箱行从下一步起替换上一个 preset 的；会话日志与对话记录不动，因此恢复会话时重建的是它实际运行过的组合。输入框里的「AI 集群」开关在任何模式下都能设置会话级集群偏好——工作模式的流程可以自行声明集群步骤，此偏好叠加在其上。

内置名册是下表五个 preset；AI 可用 `mode_list` 与 `mode_write` 继续创作模式，存放在 harness home 的 `.agent-presets/` 目录，新模式只能从已有模式复制插件组合、不能凭空造。其中两个是带声明流程的 work 模式：研究模式走「规划 → 取数 → 分析建模 → 验证 → 报告」，技能创作模式（「从会话创建」标签页把转录交给的那个模式）走「读转录 → 提炼 → 访谈确认 → 起草 → 校验落盘」；`flow_step` 工具把模型进入的每一步写进会话日志，由步进条展示。

| 模式 | 定位 |
|---|---|
| **研究模式** | 功能完整的 AI 金融研究员（默认） |
| **深研模式** | 长思考：拆解问题、显式假设、多源交叉验证、主动证伪后再下结论 |
| **极简模式** | 仅 shell + 编辑器 + todo 清单，跑脚本看数 |
| **创造模式** | 让 AI 帮你创造自定义金融组件与 preset |
| **技能创作模式** | 把过往对话沉淀成可复用技能：读转录、提炼、访谈确认、起草、校验落盘 |

## 资产、研究台与评审

- **资产中枢** —— `research-assets` 页面读取全局资产库：资产以卡片墙或紧凑表格呈现，每个版本的 `face.json` 经 `runVerb` 桥逐组件渲染，血缘图基于快照的依赖边，reports 页签带命题条，mode-flows 页签按声明的步骤给 preset 分组；**交给 AI** 会新建一个以资产 brief 开场的会话。
- **研究台（Work 模式）** —— 一张研究台把一组已入库资产与其运行约定绑在一起。[`finance/workbenches/hs300-research.yaml`](finance/workbenches/hs300-research.yaml) 是随仓库附带的那个：会话按名字进入，运行资产声明的 verb 而不是从零重做，每次修改都归档为新版本。
- **圆桌** —— 多个发言身份共享一份对话记录，支持内置或自定义座次、`shallow`/`deep` 两档研究深度、@ 点名、打断、从已有会话播种的圆桌，关闭后的圆桌归档供 `roundtable_list` 与 `roundtable_read` 读取。
- **红蓝对抗评审** —— `/rb-check <报告路径|命题id>` 与 agent 可调用的 `rb_check` 把红队攻击、蓝队回应依次注入当前会话；两段 prompt 都可在设置里修改。
- **命题跟踪** —— `thesis_list`、`thesis_show`、`thesis_write`、`thesis_mark` 把报告的结论落成一份带指标、到期日与 hit/miss 累计评分的 manifest。
- **工具记忆** —— `memory_write`、`memory_read`、`memory_list` 把持久笔记存在全局库与项目库两处。
- **数据与环境、帮助** —— 侧边栏的“数据与环境”页探测金融 venv、关键模块与资产库位置；“帮助”页给出快速开始路径、模式与流程说明和功能地图。
- **桌面壳** —— [`apps/desktop/`](apps/desktop/) 用 Electron 窗口承载本地 Web UI，带托盘图标、全局热键 `Alt+Shift+D` 与可选开机自启；它启动的服务与 `start-findeck.ps1` 相同，所以关掉窗口不影响正在跑的会话。

金融层自身的清单见 [`finance/README.zh.md`](finance/README.zh.md)，生成的工具 schema 见 [`docs/tool-catalog.zh.md`](docs/tool-catalog.zh.md)。

## 目录结构

```
finance/            the FinDeck finance layer (skills, assets, pipelines, docs)
  skills/           AI-facing manuals, mounted into every session
  workbenches/      Work-mode definitions: a named asset set plus its run conventions
  pipelines/        scheduled asset pipelines (pipeline.yaml + step scripts)
  face-spec/        asset-face spec, validator, and verb-bridge protocol
  experiments/      repeatable experiment scripts
  python/           data-environment bootstrap (venv + preinstalled data libs)
output/             pipeline outputs and local analysis artifacts (generated, not committed)
packages/           the harness packages, with FinDeck's own living alongside them
  skill/            finance tools: asset library, thesis, memory, roundtable, red/blue
  preset/           agent presets, the in-session mode switch, and mode authoring
  client/           Web UI plugins (shell, assets, roundtable, red/blue, modes, pages)
apps/               CLI, Web UI front end, and the Electron desktop shell
config-examples/    settings/credentials templates (keys left empty)
```

## 致谢

FinDeck 是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）的衍生项目。上游商标政策见 [BRAND_GUIDELINES.md](BRAND_GUIDELINES.zh.md)。数据来自公开接口（东方财富、新浪、Yahoo、加密货币交易所），经由 akshare / yfinance / ccxt / baostock 这些优秀的开源库获取——再分发数据前请确认各库与数据源的使用条款。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
