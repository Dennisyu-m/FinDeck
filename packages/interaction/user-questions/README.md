---
description: "Waterfall-based question and answer service for tools, permission plugins, local answerers, and Agent-scoped Web interactions."
kind: "package-reference"
---

# @deepseek-ai/dsh-user-questions

English | [中文](README.zh.md)

## Summary

User-interaction Service Definition. It owns `ctx.userQuestions`, the service a model-facing tool or permission plugin uses when it needs to pause work and ask the human for a decision. Use it when a consumer must suspend an operation until the user answers. A timed request (`askTimed`) bounds that suspension: the agent continues when the window closes, and the question stays answerable through the `userQuestions` Session projection.

## Table of Contents

- [Service: `UserQuestionService` (ctx key: `userQuestions`)](#service-userquestionservice-ctx-key-userquestions)
- [Role](#role)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="service-userquestionservice-ctx-key-userquestions"></a>
## Service: `UserQuestionService` (ctx key: `userQuestions`)

### Public API

- `ctx.userQuestions.ask(request): Promise<AskUserQuestionAnswer>` Dispatch the answerer waterfall and wait for the first accepted answer.
- `ctx.userQuestions.askTimed(request, callId, timeoutMs): Promise<TimedUserQuestionResult>` Foreground wait with a deadline; returns `{ pending: true, callId }` when the window closes first.
- `ctx.userQuestions.attachWait(agent, callId, signal)` Remote stream a Client claims to hold the foreground wait and read its remaining duration.
- `ctx.userQuestions.answer(agent, callId, answer)` Remote call that queues one late reply as a `user-question-reply` user message. Returns whether the question was still answerable; rejects with `BAD_ANSWER` or `REPLY_QUEUED`.

### Key Types

- `AskUserQuestionRequest` — `{ questions: [{ id, question, detail?, header?, options?, multiSelect?, intent? }], agent?, signal?, wait? }`; `detail` supplies supporting text that providers render with the question without turning it into an option label. When present, `agent` must be the registry's exact live runtime root.
- `AskUserQuestionOption` — `{ label, description? }`.
- `AskUserQuestionIntent` — `{ kind: 'plan-review', approve, callId? }`; the tagged presentation intent below.
- `AskUserQuestionAnswer` — `{ answers: [{ id, selected, custom? }] }`.
- `PendingUserQuestion` / `SettledUserQuestion` / `UserQuestionProjectionView` — the `userQuestions` Session projection: still-answerable timed calls (`state: 'open' | 'continued'`) and the calls an answer settled.
- `UserQuestionError` — `HarnessError` subclass with codes such as `EMPTY_QUESTIONS`, `BAD_INTENT`, `NO_PROVIDER`, `ASK_ABORTED`, `ASK_TIMED_OUT`, `CALLER_NOT_LIVE`, `DELEGATED_CALLER`, `BAD_ANSWER`, and `REPLY_QUEUED`.

For a single-select question, `custom` overrides the selected choice and `selected` is empty. For a multi-select question, `custom` may supplement the labels in `selected`. A UI may preserve a skipped item as `{ id, selected: [] }`, keeping the existing answer shape while retaining other answers in the batch.

When a request carries an agent, `ask()` authenticates its exact identity through the live `AgentRegistry` and admits only a runtime root. Durable lineage is not authority: a session with historical delegation depth may ask after it is resumed as a new runtime root, while a live child owned by another agent is rejected even if its durable depth is zero. The Web answerer receives only Agent-scoped requests; an agentless programmatic request remains available to unscoped local waterfall listeners and fails with `NO_PROVIDER` when none accepts it.

### Presentation intent

`intent` declares that a question IS a known kind of decision, so a UI that recognises the tag may present it as such — `plan-review` says `detail` is a plan under review, and `dsh-plan-mode` sets it on the `exit_plan_mode` question. An intent changes presentation only: a UI honouring it answers with the same option labels a generic UI would send, and a UI that does not know the tag renders the generic option list, so callers read the same answer fields either way. `approve` names the label that approves rather than relying on option order. `ask()` rejects with `BAD_INTENT` the two assertions no type can carry: an `approve` naming none of that question's own options, and an intent on a question with no `detail` — the thing it declares itself a review of.

### Timed waits and late replies

`askTimed` bounds the foreground wait. The Host holds the deadline and runs its timer only while no answer UI claims the wait through `attachWait`; a claim suspends the Host timer in favour of the Client's own countdown, and releasing the last claim restores the original deadline. When the window closes, the tool returns `{ pending: true, callId }` and the Turn is not cancelled — the agent continues independent work.

The `userQuestions` Session projection is what keeps the question answerable afterwards. It tracks an `ask_user_question` call only when the logged request header declares the timed tool schema's `timeout` parameter, marks that call `continued` when its result carries the pending payload (or Session resume repair appended `TOOL_OUTCOME_UNKNOWN`), and moves it to `settled` when a reply's `user/message` is admitted. The projection is the Client's whole view: no deadline, focus, or wait state is logged.

`answer()` steers one complete batch into the agent as a user message whose source is `{ kind: 'user-question-reply', callId, outcome: 'answered' }` and whose text is the `answer_to_pending_question` JSON payload (the original questions plus the batch). The batch must name each question of the call exactly once, and only one reply may be queued per call; a discarded queued reply leaves the question answerable.

<a id="role"></a>
## Role

This is the Service Definition package. Consumers such as `@deepseek-ai/dsh-tool-ask-user` depend on this service; the Web client contributes an Agent-scoped answerer through Remote Events. The loop stays unchanged: a tool call awaits the waterfall result, and that result resumes the normal agent loop.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-ask-user`, which retains a successful answer as compact JSON or one of these failures: `Error: ask_user_question was aborted before the user answered`, `Error: ask_user_question requires at least one question`, `Error: human interaction requires the exact live calling agent when an agent is supplied`, `Error: human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result`, `Error: no user-questions answerer accepted the request`, or `Error: <message>`. Waiting for the human adds no tokens.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Agent-scoped Web answering** — Remote Events route the shipped Web answerer only when the request carries a live Agent scope; agentless callers need an unscoped local waterfall listener.
- **The vocabulary is the question-form shape only** — selectable options plus optional custom text; richer interaction shapes (file pickers, diff-preview confirmations) have no seam vocabulary yet.
- **A late reply needs a live root agent** — `answer()` resolves the exact live instance through the `agent` Remote parameter, so a reply for a Session whose agent is not running fails instead of queueing; the Web layer resumes the Session first.
- **Timed tracking needs the logged schema** — the projection recognises a timed call from the recorded `request/header`, so a Session seeded or replayed without headers folds to the empty view.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The single provider slot is validated at registration and asks return directly to their caller; the seam publishes no independent request/answer audit stream.
