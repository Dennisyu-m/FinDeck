---
description: "The model-facing ask_user_question tool over the user-questions seam, for users and maintainers composing or debugging interactive agent surfaces."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-ask-user

English | [中文](README.zh.md)

## Summary

`dsh-tool-ask-user` gives the model one tool — `ask_user_question` — for asking the human a concise question when it needs confirmation, a choice, or missing information before continuing. The tool pauses until the first scoped answerer accepts the request, then feeds that answer back into the agent loop as an ordinary tool result, so no loop mechanics change. The tool returns the canonical `{ answers: [...] }` shape, rendered as compact JSON text. It renders no UI itself and does not know how input is collected; the Web client contributes its answerer through Remote Events. A runtime-owned child agent cannot ask the user; it must include the unresolved question in its final result.

`Config.mode: 'timed'` swaps that definition for the opt-in timed one: the foreground wait is bounded by `Config.timeout` seconds, and when it closes the tool returns `{ pending: true, callId, message }` so the agent continues while the question stays answerable through the `userQuestions` Session projection.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin wherever the model should be able to pause for a human decision: it provides the `ask_user_question` tool and needs the `ctx.userQuestions` seam with an answerer that accepts the scoped request. Without one, the tool call fails with an error instead of degrading.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `mode` | `'legacy'` | `'legacy'` registers the blocking tool; `'timed'` registers the bounded-wait tool. |
| `timeout` | `120` | Foreground wait in seconds for a timed call that omits its own `timeout` argument. `-1` waits indefinitely. |

Timed mode is opt-in: the shipped presets compose the default legacy row, so every existing Session keeps the blocking behavior until a deployment states `mode: timed`.

```yaml
- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'
  config:
    mode: timed
    timeout: 120
```

### When to call the tool

The model calls `ask_user_question` when it needs confirmation, a choice, or missing information before proceeding. Send one or more questions, each with a stable `id` that is echoed in the answer; a recommended option goes first with `(Recommended)` appended to its label.

```json
{
  "questions": [
    {
      "id": "cleanup",
      "question": "Proceed with the destructive cleanup?",
      "header": "Confirm",
      "options": [
        { "label": "Yes, delete them (Recommended)", "description": "Removes the three stale files." },
        { "label": "No, keep them", "description": "Aborts the cleanup." }
      ]
    }
  ]
}
```

Under timed mode the model may also pass a per-call `timeout` in seconds, which overrides the configured default for that call; `-1` waits indefinitely. A call whose window closes returns pending, and the model sees the questions remain answerable rather than an answer it never received.

### What the model gets back

The tool returns one answer object per question: `selected` holds the chosen option labels, and `custom` carries a free-form answer — supplementing `selected` for a multi-select question and overriding it for a single-select question. The Native renderer preserves the compact JSON text shape.

```json
{ "answers": [{ "id": "cleanup", "selected": ["Yes, delete them (Recommended)"] }] }
```

A timed call that reaches its deadline instead returns `{ pending: true, callId, message }`. The `message` field states that the user can still answer and that the reply will arrive as an `answer_to_pending_question` user message naming the call; it is a field of the result value rather than prose beside it because the recorded result text is read back as one JSON object by both the `userQuestions` projection and the transcript row.

### When the call fails

In legacy mode the tool call blocks until the human answers and cancels only through the turn's signal. No accepting answerer, an aborted call, or a caller that is not the exact live runtime root each settles as an error the model sees in the tool result — most notably, a live child agent owned by another agent is rejected (`DELEGATED_CALLER`) and must include the unresolved question or decision in its final result. A timed call adds two load-time and call-time failures: a `timeout` outside `-1` or 1–2147483 seconds is rejected when the definition is registered or the call starts, and duplicate question ids within one call are rejected before the request reaches the seam.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The observable behavior is covered in [Use this package](#use-this-package); this section explains the tool definition and its relationship to the seam.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `Config`, mode selection, and the default blocking tool definition |
| [`src/timed.ts`](src/timed.ts) | The opt-in timed definition: bounded wait, per-call `timeout`, pending result |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream; execution relations are owned by the capability seam it calls. |

### Consumer role

The plugin registers exactly one `defineTool` entry on `ctx.tools` with injects `['tools', 'userQuestions']`; `Config.mode` picks which definition that is. Both definitions map model arguments into an `AskUserQuestionRequest`, forward the exact calling agent and the turn's signal, and map the accepted answer back into the canonical `answers` array. The timed definition calls `askTimed` with the resolved timeout and the tool call id, and renders the pending payload unchanged when the wait ends first; its schema declares the `timeout` parameter whose presence in the logged request header is what the `userQuestions` projection reads to tell a timed call from a blocking one. The seam owns identity checks, intent validation, waterfall dispatch, the wait state machine, and the error taxonomy; this package only translates.

### Result rendering

The `render` output projects the structured value to a single text block via `JSON.stringify`, which is why the model-facing result is compact JSON rather than a richer content-block vocabulary. The timed definition's output schema is a `oneOf` over the answer batch and the pending payload, so the model reads the deadline outcome as a first-class result rather than a failure.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tool surface to the seam contract and its answerer waterfall.

- [User interaction subsystem reference](../../../docs/subsystems/user-questions.md) — the service contract, question vocabulary, and answerer waterfall behind this tool.
- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ask-user) — the generated `ask_user_question` schema.
- [user-questions package](../user-questions/README.md) — the seam this tool consumes.
- [Interaction group map](../README.md) — adjacent approval and command surfaces.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`ask_user_question` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ask-user), including question ids, prompts, headings, options, and multi-select flags. The timed definition adds the `timeout` parameter and describes the pending outcome; the shipped presets compose the legacy definition, so this is the schema unless a deployment opts in.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

The model's full questions remain in the assistant tool-call arguments. After the human answers, the next step sees compact JSON in the exact shape `{"answers":[{"id":"<id>","selected":["<label>"],"custom":"<text>"}]}`; `custom` is omitted when unused and `selected` can contain zero, one, or several labels. UI interaction while the call is pending is not model context.

#### Token effect

Arguments and answer JSON are data-dependent retained tokens; there is no token cost while waiting for the human.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit. They are current package constraints, not a UI backlog.

- **The default definition blocks the tool call until the human answers** — the legacy tool declares no `timeout-policy` budget and cancels only through the turn's `exec.signal`; `mode: timed` is the opt-in bounded alternative.
- **A timed question needs a client to keep it answerable** — with no connected answerer the foreground wait still expires and the agent continues, but nothing can deliver the late reply until a UI holding the `userQuestions` projection is connected.
- **Runtime-owned subagents cannot ask the user** — `ask_user_question` rejects a live child owned by another agent with `DELEGATED_CALLER`; the child must include the unresolved question or decision in its final result. Durable lineage does not decide this boundary, so a lineage-bearing session resumed as a runtime root may ask normally.
- **Native answers render as JSON text** — the canonical value remains structured, but the model-facing result uses compact JSON rather than a richer content-block vocabulary.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
