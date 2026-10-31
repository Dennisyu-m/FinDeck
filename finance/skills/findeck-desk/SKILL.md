---
name: findeck-desk
description: >
  中文：FinDeck 值班任务的执行纪律与四段式报告格式——先用 desk_preferences 读取确定性反馈汇总，只解读有异动的对象，按要点（≤5）/异动解读/命题复检/待你决策四段调 desk_report 归档，每个数字标注资产名与版本；无数据来源时如实写明，不编造。
  English: FinDeck desk-run discipline and the four-section report format — read the deterministic feedback summary with desk_preferences first, interpret only objects with signals, archive through desk_report as points (max 5) / move interpretation / thesis recheck / decisions for the user, citing each number by asset name and version, and naming missing data sources instead of inventing numbers.
whenToUse: 当你以值班任务的身份运行时（profile desk、自动化触发的 headless 会话），或用户询问值班报告为什么这样写、如何补数据来源时。
---

# FinDeck 值班执行纪律

值班任务只运行已有的东西：库内资产、asset verb、定时产出的数据、命题复检。**不新建研究组件**
（数据集、模型、代码、工具、Work），也不执行任意 shell。唯一允许的写操作是归档本次运行
的报告资产，以及调用 `thesis_mark` 记录命题复检。

## 1. 运行顺序

1. **先调 `desk_preferences`**。它返回近窗口内用户反馈的确定性汇总（哪些任务、哪些来源
   被标记为无用，哪些被标记为有用）。这是模型可见输入，出现在会话日志里；不要凭记忆假设偏好。
2. 读取提示里给出的确定性信号表：只有 `status: move` 的标的值得展开解读。
   `stale` / `missing-source` 的写「数据未更新」或「缺少数据来源」，不要补造数字。
   `recorded` 的资产/命题/workbench 只在报告引用其事实，不展开无依据的推断。
3. 到期命题用 `thesis_show` 看历史，再用 `thesis_mark` 记一次 hit/miss 与证据；证据必须
   是本次运行真的读到的数据。
4. 最重要的 1–3 条结论用 `rb_check` 过一轮红队。红队推翻的结论写进「待你决策」，不要删掉。
5. 用 `desk_report` 归档报告，然后结束。不要在工作区里另写报告文件。

被工具层拒绝的调用会自动出现在运行审计里，`desk_report` 会把它们写进「待你决策」。
值班的资产执行在组合层启用 sandbox，写权限只落在资产库；被拒绝的写操作不会被当成成功，
也不存在“换个工具入口就能绕过”的未受限路径。
不要试图绕过权限：换工具、换路径、换参数都不是允许的做法。

## 2. 报告四段

`desk_report` 的参数就是四段内容：

| 参数 | 约束 | 写什么 |
|---|---|---|
| `points` | 1–5 条，每条一句话 | 本次最重要的结论；每条尽量带资产名 + 版本 |
| `moves` | 非空 | 异动解读：变化多大、可能的原因、反证 |
| `theses` | 非空 | 命题复检：调用了哪些 `thesis_mark`，结果与证据；未复检就写未复检 |
| `decisions` | 可选数组 `{kind, text}` | 需要用户决定的事：越权调用、红队推翻的结论、建议增删的关注对象 |

- `kind` 用 kebab-case：`permission` / `redteam` / `target` / `data` / `system` / `note`。
- 每个数字必须能追溯到资产名与版本；来源版本由执行器从本次运行的 signal 记录和本次 AI 阶段
  实际 `asset_show` / `asset_run` 的解析版本合并写入报告尾部。模型不需要也不应该自己列版本清单；
  没有实际读取的版本不会被记入，旧记录会明确标为来源不完整。
- 不为写满四段而编内容。没有异动就写「本次没有达到阈值的异动」，不要硬找原因。
- 报告不构成投资建议；不写收益承诺、目标价或仓位指令。

## 3. 无解读版

AI 部分失败（模型额度、网络、超时、预算耗尽）时，执行器会用信号表直接归档一份
**无解读版**报告，标签含 `no-interpretation`，四段中的解读与复检明确写「未执行」。
这是失败降级，不是正常结果；不要把它描述成成功运行。

## 4. 与其它层的关系

- 关注对象属于当前任务本身（`~/.findeck/desk/tasks/<name>.yaml`），不存在全局关注列表。
- 刷新走目标声明的 `refresh`（库内 asset verb 或流水线），不要在每次运行里重写取数脚本。
- 报告是 `kind: report` 的资产，tags 为 `[desk, <任务名>]`；用户在值班页查看、追问、
  标记有用/无用/已处理。
- 任务管理（新建、编辑、启停、立即运行、取消）由普通会话里的 `desk_list` / `desk_show` /
  `desk_write` 和值班页共同调用同一个宿主接口；值班运行本身不改任务定义。
