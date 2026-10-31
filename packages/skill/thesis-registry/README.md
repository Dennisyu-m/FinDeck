# @deepseek-ai/dsh-thesis

Durable thesis registry for FinDeck: one YAML manifest per testable conclusion under `<harness home>/asset-library/theses`, with derived status (`open` / `hit` / `miss`), overdue flags, and a registry-wide hit/miss score.

## Service

`ctx.thesis` provides `list`, `get`, `write`, `mark`, `score`, and `due`. `tool-thesis` exposes the same registry to the model; the desk service adopts report conclusions and computes the scorecard; the research-asset page reads the same records. This package owns the manifest file format and the atomic write.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `thesesDir` | `<harness home>/asset-library/theses` | Registry root |

## Semantics

- Status derives from the newest check; a thesis with no check is `open`.
- `due(today)` returns theses whose due date passed with no check dated at or after it.
- `mark` appends one check; an empty evidence string is refused.
- Hit rate is `hits / (hits + misses)` over every check, `null` while no check exists.

## Model Experience

The registry itself reaches no model request. `tool-thesis` renders the records as tool results, so a thesis the user adopted in the desk page becomes visible only through a logged tool call. The registry adds no prompt section, no automatic context, and no token cost until a tool reads it.

## Known Limitations and Deferred Work

- A malformed manifest fails the whole listing instead of being skipped; repairing the file is the intended fix.
- The registry has no lock beyond atomic rename; two writers editing the same id concurrently keep the last rename. `tool-thesis` and the desk host are same-process writers.
