---
description: "The model-facing FinDeck thesis tools: register testable conclusions from finished reports, list the ones due for recheck, and record recheck outcomes so a running hit/miss score accumulates."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-thesis

English | [中文](README.zh.md)

## Summary

Research reports state conclusions that later data can confirm or refute. This consumer package gives the model tools over the durable thesis registry owned by [`@deepseek-ai/dsh-thesis`](../thesis-registry/README.md), so a conclusion becomes a tracked object with a metric, a due date, and a score instead of a paragraph nobody rechecks: `thesis_list` summarizes every manifest with its derived status and the registry score, `thesis_show` returns one thesis with its complete recheck history, `thesis_write` upserts one manifest (when the composition allows it), and `thesis_mark` records one recheck outcome with the evidence that decided it. The same registry feeds the research-asset page's thesis view, the desk scorecard, and the value desk's due-date trigger.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside `@deepseek-ai/dsh-thesis` to give the agent a place to register and recheck conclusions. It requires `ctx.tools` and `ctx.thesis`; the registry directory is configuration on the registry row.

### When to choose it

Use it in FinDeck compositions where research sessions produce reports that state falsifiable conclusions. A session that only answers questions has nothing to register, so the tools stay idle until the research protocol's thesis step asks for one. The unattended desk composition sets `allowWrite: false`: it may recheck an existing thesis but not create a new one.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-tool-thesis'
  config:
    allowWrite: true
```

| Field | Default | Meaning |
|---|---|---|
| `allowWrite` | `true` | Whether `thesis_write` is registered at all. `false` keeps listing, showing, and rechecking. |

### What the model gets

Tools with strict argument validation:

- `thesis_list` — every manifest with `id`, `conclusion`, `metric`, `threshold`, `due_date`, `report`, `assets`, the derived `status`, `overdue`, `check_count`, plus the registry `score`.
- `thesis_show` — one manifest in full: every field plus the complete `checks` history (date, outcome, evidence) and that thesis's own hit/miss score.
- `thesis_write` — upsert one manifest; an existing id keeps its check history and `created_at`.
- `thesis_mark` — append one `hit`/`miss` check with non-empty evidence and a `checked_at` stamp.

### Observable success and failures

A successful write returns the stored manifest summary; a successful mark returns the updated status and score. Rejections are loud: an id that is not kebab-case, a due date that is not a real calendar date, an outcome other than `hit`/`miss`, empty evidence, and marking an unregistered id each fail with the rule that refused them. A manifest that is not valid YAML, or whose declared `id` differs from its file name, fails the whole read instead of being skipped.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design concept

The registry is files-first: one manifest per thesis, named by id, so a user can read, diff, and hand-edit the same files the tools write. `@deepseek-ai/dsh-thesis` owns parsing, validation, atomic writes, and derived status; this package only registers the model tools over that service.

### Source map

- `src/index.ts` — tool registration and output rendering; every read and write delegates to `ctx.thesis`.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Research protocol step 9](../../../finance/skills/findeck-research/SKILL.md) — where the model is told to register a thesis and recheck the due ones.
- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-thesis) — the generated schema reference for the four tools.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`thesis_list` / `thesis_show` / `thesis_write` / `thesis_mark` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-thesis).

#### Token effect

Fixed schema cost per request where the tools are visible.

#### KV Cache effect

Prefix-stable while the tool definitions and visibility are unchanged.

### Tool results and errors

#### What the model sees

`thesis_list` renders the score line plus one line per thesis (status, due date, check count, overdue flag). `thesis_show` renders the manifest fields plus every recorded recheck with its evidence; `thesis_write` renders the stored manifest summary; `thesis_mark` renders the updated status and score. Rejections render the validation rule that refused the call, and a corrupted registry renders the file and its parse failure.

#### Token effect

Cost scales with the number of manifests and the length of each `conclusion`; a recheck adds only its own result line.

#### KV Cache effect

Append-only; newly visible results follow the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the registry is a poor fit. They are current package constraints, not a task backlog.

- **The score is unweighted** — every check counts once, so a thesis rechecked ten times moves the registry score ten times; there is no per-thesis weighting.
- **Due dates alone do not run a recheck** — `due_date` and `overdue` are read-side flags; the value desk's `thesis-due` trigger dispatches a run, and any other composition must bind the recheck itself.
- **No metric evaluation** — the tools store what the model concluded; fetching data and computing the metric stays with the caller.
- **One registry per directory** — the config names a single `thesesDir`; separate registries need separate plugin rows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
