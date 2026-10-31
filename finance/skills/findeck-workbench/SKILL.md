---
name: findeck-workbench
description: >
  中文：FinDeck Work 模式（workbench.yaml）速查——Work/Free 判定、定义格式与校验、开场资产锚（workbench show 的 brief）、"运行资产而非从零干"的硬纪律、改资产后的汇报与归档、把成组资产固化为新 workbench。用户点名"研究台/Work 模式"时读它。
  English: FinDeck Work mode (workbench.yaml) reference — the Work/Free test, the definition format and validation, the session-opening asset anchor from the workbench show brief, the hard rule of running archived assets instead of rebuilding from scratch, and freezing an asset group into a new workbench.
whenToUse: 用户提到某个 workbench / 研究台 / Work 模式，要围绕一组已有资产反复提问，要把资产运行结果解读成报告，或要把成组的高频资产固化成新的 Work 模式时。
---

# FinDeck Work 模式（workbench）

## 1. 什么是 Work 模式

**Work 模式 = 资产集合 + 运行约定 + AI 角色。**

- 它绑定一组**已有资产**（如"沪深300研究台" = 成分股名单 + 月度面板 + 排序模型 + 日报），
  以及这组资产的**运行约定**（常用 verb 序列、参数边界、解读要求）。
- **AI 的角色是操作员 + 评论员，不是苦力**：用户在这个模式里问"今天预测多少"，你不从零建模，
  而是运行这些资产声明的 verbs（update → predict → 解读），并给出自己的见解。
  你保留完整灵活性（运行顺序、组合方式、解读角度自己定），也保留**修改权**
  （调参数、改代码、重训模型）——但**每次修改必须汇报**。
- AI 的能力不为 Work 模式设限：Work 能干什么由定义里的资产与约定决定；"每次产出一个新报告"
  只是其中一种约定，不是 Work 的固有属性。

**判定口诀：有资产可锚 → Work；没有 → Free。**

| | 锚 | AI 干什么 |
|---|---|---|
| **Work** | 一组已入库资产（workbench.yaml 定义） | 运行资产作答 + 解读 + （可选）修改并汇报 |
| **Free** | 无 | 想干什么干什么：从零研究/拉数/建模/上网 |
| 流水线（pipeline） | 同一组资产 | Work 模式的**定时形态**：无人值守、固定步骤 |

Free 的好产出要按 `findeck-research` 的归档纪律沉淀为资产；资产聚合成组、用户需求高频时，
再固化成 Work 模式（见第 5 节）。

## 2. 进 Work 模式的第一件事：拿锚

用户点名某个 workbench（"进沪深300研究台""用 xx 研究台看一下"）时，**先拿锚再动手**：

```sh
cd <仓库根>
finance/python/.venv/Scripts/python.exe -m findeck.workbench show hs300-research
```

`show` 打印的 brief 就是你的**会话锚**，含：

- workbench 名 / 展示名 / 描述；
- 每个资产的【名字、最新版本号、**版本目录绝对路径**、kind、verbs、as_of（若有）、描述、上游资产】——
  路径都是真的，可以直接 `pd.read_parquet('<版本目录>/xxx.parquet')` 或交给 `asset_*` 工具；
- conventions 全文（常用 verb 序列 + notes 运行约定）。

其它命令：

```sh
finance/python/.venv/Scripts/python.exe -m findeck.workbench list     # 有哪些 workbench
finance/python/.venv/Scripts/python.exe -m findeck.workbench validate finance/workbenches/<name>.yaml
```

随产品交付的定义放 `finance/workbenches/<name>.yaml`；用户在资产页多选资产创建的定义放
`<家目录>/workbenches/<name>.yaml`（`FINDECK_WORKBENCH_DIR` 可改），同名时用户定义优先。
校验器是 `finance/python/findeck/workbench.py`（与 pipeline 同驻）。**拿不到 brief 就不要凭记忆
猜资产名和路径**——用 `asset_search` 检索库，或直接读 brief。

## 3. 硬纪律（Work 模式会话必须遵守）

1. **优先运行资产，而非从零干。** 用户的问题能用已有资产回答时，运行资产的 verbs（经
   `python -m findeck.verb_bridge '{"asset":"...","verb":"...","params":{...}}'`，或按其
   `lineage.producer` 跑对应脚本/流水线），不要重新拉数、重新建模、重写已有脚本。
   数据资产先核对 `freshness.as_of` 是否覆盖你要回答的区间：不覆盖就走它的更新动作（如 `update`），
   而不是绕开资产库另拉一份。
2. **修改资产前先说明意图。** 要调参数、改代码、重训模型时，先讲清：改哪个资产、改什么、为什么。
3. **修改必须经 `assets.archive()` 落成新版本，永不覆盖。** `version` 递增、
   `supersedes` 指向前一版、`origin` 按实际来源填；改完把新版本目录路径写进汇报。
4. **修改后必须汇报三件事**：**改了什么 / 为什么 / 前后对比**（修改前后的验证指标与实际影响）。
   汇报写进本轮回答（不是只在心里想），并让修改记录进会话与资产 `lineage`。
5. **每次会话产出解读 report 资产。** 运行完资产、给出见解后，把解读按 `findeck-research`
   第 8 步的归档纪律归档为 `kind=report` 资产（`validation` 必须来自实跑，禁止编造），
   报告里注明所依据的资产名与版本；下次会话就有锚可复用。
6. **能力不被 Work 定义封死。** 约定之外的合理动作（补充数据、查资料、临时实验）照做，
   只要能说清为什么；但"绕过已有资产从零重做"必须有明确理由（资产缺失、过期且无法更新、口径不符）。

一段典型轨迹：**运行资产 → 解读（产出 report 资产）→ 必要时修改资产（说明+汇报）→ 再运行验证**。

## 4. workbench.yaml 格式速查

```yaml
name: hs300-research            # kebab-case，必须与文件名一致
display_name: 沪深300研究台      # 必填非空，UI 展示名
description: 围绕沪深300资产的日常研究台   # 必填非空
assets:                         # 必填非空；每个名字必须存在于资产库 index.json
  - hs300-constituents
  - hs300-monthly-panel
  - hs300-monthly-rank-model
  - hs300-daily-report
conventions:                    # 可选对象；给了就必须是对象
  verbs: [update, predict]      # 可选，常用 verb 序列（kebab-case，建议序非硬编排）
  notes: |                      # 可选，自由文本：参数边界、解读要求等运行约定
    每次会话结束产出解读 report 资产
```

- `conventions.verbs` 写这组资产**实际声明过的** verbs（读各资产最新 manifest 的 `verbs` 字段，
  或 brief 里的 verbs 行），是"常用建议序"，不是硬编排——你仍可按问题自由决定运行顺序。
- `conventions.notes` 写运行约定：参数边界、解读要求、产物要求、禁忌。

校验规则（全部 fail loud，未知键一律拒绝）：

- 顶层键**恰好** `{name, display_name, description, assets, conventions}`；
- `name` kebab-case 且与文件名一致；`display_name` / `description` 非空字符串；
- `assets` 非空列表、元素唯一、每个都在资产库 index.json 中存在（名字写错直接报错并列出库里现有的）；
- `conventions` 键 ⊆ `{verbs, notes}`；`verbs` 是 kebab-case 非空列表；`notes` 是非空字符串。

写完/改完**必须**跑校验：

```sh
finance/python/.venv/Scripts/python.exe -m findeck.workbench validate finance/workbenches/<name>.yaml
```

通过打印 `[workbench] 校验通过: <name>（N 个资产，<展示名>）`；失败退出码 1 并逐条打印中文错误。

## 5. 起草新的 Work 模式（Free → Work 的升级）

当某类资产**成组**（同一业务面的数据/模型/报告反复一起用）且用户**高频**需要时，主动提议固化为
Work 模式，不要等用户开口：

1. 盘点资产：用 `asset_search` / `list_all()` 找出这组资产，确认它们的真实名字（`assets` 必须精确匹配）
   与各自声明的 verbs；
2. **起草** `finance/workbenches/<name>.yaml`（格式见第 4 节），`conventions.notes` 写清运行约定；
3. **跑校验器**，直到通过；
4. **请用户确认**（`ask_user_question` 或直接询问）：展示 display_name/description/资产清单/约定，
   说明"确认后这个研究台就可在后续会话里按下述约定直接开工"；
5. 用户确认后才把它当作既定 Work 模式使用／写进后续会话；用户不确认就保留草稿或删除，
   **不要单方面把草稿当成正式 Work 模式**。

新增 workbench 不改变任何资产——它只是资产集合 + 约定的固化，资产本身照旧在库里。
