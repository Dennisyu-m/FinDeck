# FinDeck 金融层

[English](README.md) | 中文

这个目录提供 FinDeck 的金融数据环境、研究技能、资产工具和可复用的任务定义。产品概览，以及当前源码与可下载安装包的区别，见[根目录 README](../README.zh.md)。

| 路径 | 内容 |
|---|---|
| `skills/` | AI 的"手册"（14 个），挂载进每个会话 |
| `pipelines/` | 定时资产流水线（`<名字>.yaml` 定义 + 步骤脚本）：`daily-refresh`（面板 → 模型 → 日报）、`weekly-healthcheck`（资产体检报告） |
| `face-spec/` | 资产脸规范：`face.schema.json` + `validate_face.py` + examples，以及 `verb-bridge.md`（脸执行库内 verb 的协议） |
| `workbenches/` | 随产品交付的 Work 模式定义（`<名字>.yaml`）：具名资产集合 + 运行约定，由 `python -m findeck.workbench` 读取（`list`/`show`/`validate`）；用户从资产页创建的定义放 `<家目录>/workbenches/`，同名时优先 |
| `python/findeck/` | 内置工具箱模块：`assets`（全局资产库）、`background`（后台 run 记录，供 `verb_bridge` 与 `pipeline` 的 CLI 共用）、`charts`（图表工厂）、`desk`（任务校验、确定性信号、报告归档）、`pipeline`（pipeline.yaml 校验器/执行器）、`quickmodels`（统一建模）、`snapshot`（数据快照）、`verb_bridge`（face verb 执行桥）、`workbench`（workbench.yaml 校验器与 brief 生成器） |
| `python/.venv/` | 数据环境（由 setup 脚本创建；通过 `.pth` 注册 findeck 包） |
| `python/requirements-data.txt` | 预装清单，带上界（数据 + sklearn/lightgbm/statsmodels） |
| `python/setup-env.ps1` / `.sh` | 幂等引导脚本（清华镜像优先，`FD_PIP_INDEX` 可覆盖） |
| `python/smoke-test.py` | 数据源健康检查（国内源任一可用即 PASS） |
| `python/test-toolbox.py` | 工具箱回归测试（模型 + 出图 + 快照 + 资产库） |
| `python/migrate-assets.py` | 把存量 `data/` parquet 一次性登记为 `dataset` 资产；幂等可重跑 |
| `experiments/` | 可复现实验（迭代修正思路的 A/B 验证） |
| `README.md` | 本文件 |

## 设计原则

1. **数据与经典模型预装，重型模型按需。** 拉数据 + 岭回归/随机森林/LightGBM/ARIMA
   （sklearn/lightgbm/statsmodels，经 `findeck` 工具包统一接口，AI 用 params 直接调参）；
   PyTorch 系（数 GB）按任务按需装，skill 地图指路。
2. **Skill 只指路，不装箱。** 每个 skill 是纯 Markdown：接口名、参数、代码模板、
   常见坑。AI 读了就能动手，人类也能直接阅读维护。
3. **通过插件组合金融能力。** Bundle 挂载金融技能，以及资产、命题、记忆和评审服务；共享的宿主调度器运行流水线和值班任务，专用 `desk` profile 组合无人值守执行。组合方式与扩展点见[架构说明](../docs/architecture.zh.md)。

## 研究与自动化入口

| 入口 | 定义位置 | 用途 |
|---|---|---|
| 资产流水线 | `finance/pipelines/*.yaml` 与引用的步骤脚本 | 重复执行已声明的处理步骤，并归档产物 |
| Work 研究台 | 随仓库的 `finance/workbenches/*.yaml` 或 `<home>/workbenches/` 下的用户定义 | 在交互式研究会话中复用所选资产 |
| 值班任务 | `<home>/desk/tasks/` 下的用户定义 | 计算信号并产出无人值守研究报告 |

共享调度器和值班服务运行在 Web 宿主内。通过[自动化设置](../CONFIGURATION.md#自动化与会话提醒)配置独立开关。任务管理、报告记录、反馈与限制见[值班参考](../docs/subsystems/desk.zh.md)。

## Skills 一览

| Skill | 角色 |
|---|---|
| `findeck-research` | 总纲：研究工作流 SOP + 迭代修正协议 + 报告模板 + 免责纪律 |
| `findeck-market-data-cn` | A股/港股/宏观/新闻（akshare，baostock 备选） |
| `findeck-market-data-global` | 美股/全球/加密（yfinance、ccxt）、FRED |
| `findeck-quant-models` | 模型地图：内置工具箱用法 + 神经网络按需指引 + 评估纪律 |
| `findeck-backtesting` | vectorbt/backtrader 模板 + 指标解读 + 大坑清单 |
| `findeck-visualization` | 出图规范：charts 工具箱 + read_image 展示链路 |
| `findeck-factor-analysis` | 因子检验：IC/分层/共线性/换手 |
| `findeck-portfolio` | 组合构建：等权/最小方差/风险平价/MVO |
| `findeck-macro-playbook` | 宏观剧本：美林时钟/利率传导/信用周期/政策 |
| `findeck-python-env` | 数据环境使用手册（路径/镜像/缓存/排障） |
| `findeck-pipeline` | 资产流水线：pipeline.yaml 格式、步骤 marker 协议、手动跑法、由 automation-runner 按 yaml trigger 调度、失败语义 |
| `findeck-asset-face` | 资产脸生成：8 种组件词汇表、各类资产"好脸"规则、存放位置与 manifest 声明、必须过校验器 |
| `findeck-workbench` | Work 模式操作：`workbench.yaml` 格式、开场资产锚 brief、运行资产并汇报的纪律 |
| `findeck-desk` | 值班运行纪律：读确定性信号表、写四段式报告、不越过执行权限 |

## 数据环境

```bash
bash finance/python/setup-env.sh                 # Linux/macOS/Git-Bash
powershell -ExecutionPolicy Bypass -File finance/python/setup-env.ps1   # Windows
```

产出 `finance/python/.venv`（预装清单见 `requirements-data.txt`，并把
`findeck` 工具包 `.pth` 注册进 venv）。脚本幂等，默认走清华镜像
（`FD_PIP_INDEX` 环境变量可换源），失败自动回退官方源。

工具箱回归：`finance/python/.venv/Scripts/python.exe finance/python/test-toolbox.py`
（跑模型 + 出图 + 快照纪律 + 资产库往返）。`data/market_cn_600519_daily_bs.parquet`
缓存存在就直接复用；缺失时用 akshare 拉一次 600519 日线并写入该缓存，离线则退到确定性
合成 OHLCV 数据。脚本会打印实际走的是哪条路径。

装完可跑冒烟测试：`finance/python/.venv/Scripts/python.exe finance/python/smoke-test.py`
（拉真实数据验证各源；国内源 akshare/baostock 任一通过即 PASS，境外源为信息项）。

## 资产库与数据快照

- **数据快照（R8）**：`from findeck import snapshot`——`load_or_fetch` 对同参数同日
  取数直接复用快照，真实拉取统一落 `data/snapshot_<接口>_<摘要>_<日期>.parquet`；
  `FINDECK_SNAPSHOT=0` 关闭。
- **资产库（R2）**：`from findeck import assets`——`archive` 校验 manifest（必填字段
  缺一不入库）、版本并存永不覆盖、自动重建 `index.md` + `index.json`。`packages/skill/tool-asset-library`
  的七个工具（`asset_dir`、`asset_list`、`asset_search`、`asset_show`、`asset_graph`、`asset_run`、`asset_run_bg`）
  把这些能力暴露给会话；各工具契约见[工具目录](../docs/tool-catalog.zh.md)。归档纪律见 `findeck-research` 第 8 步。

manifest v2 增加六个字段——`origin`（agent/user/imported）、`verbs`（声明的动作，无 verbs 不入库）、
`freshness`（`as_of` + `update_frequency`，dataset 必填）、`lineage`（`producer` 的
脚本/参数/会话 + `inputs`）、`tags`、`face`（版本目录内 `face.json` 的相对路径）——`index.json` v2
按资产与版本汇总这些字段；新会话用 `asset_search`（按 kind/origin/tag/verb/关键字/保鲜度检索）读索引找资产。
流水线走同一个入口归档：每个新版本 `version = 最大版 + 1`，自动填 `supersedes`、`origin='agent'`、
由步骤 `inputs` 填 `depends_on`/`lineage.inputs`、`lineage.producer = {script, params, session}`，
血缘随流水线自动累积，步骤脚本不用自己写 manifest。`weekly-healthcheck` 流水线对每个 dataset 跑
`preview` 探活、标记过期 `freshness.as_of` 与 90 天未触碰的资产，并把结果归档为报告资产
`asset-health-report`；触碰记录来自 `usage.jsonl`（资产工具写入）与 `pipeline-runs/*.jsonl`。

## 维护提示

- akshare 接口变化最快：遇到失效，更新 `findeck-market-data-cn` 的接口表即可，
  先在 [akshare 文档](https://akshare.akfamily.xyz/) 核对最新参数。
- 模型生态更新（新的时序基础模型等）：改 `findeck-quant-models` 的仓库表。
- 所有 skill 的 YAML frontmatter 必须含 `name`（kebab-case）与 `description`；description 必须是双语的——中文在前，`English:` 在后——见[描述语言规则](../docs/subsystems/skills.zh.md#description-language)。
