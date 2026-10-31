# FinDeck

English | [中文](README.zh.md)

**FinDeck** is an AI-first finance research harness — the AI is the analyst, FinDeck is its flight deck, and you are the copilot who can take over at any moment.

It is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT), an everything-is-a-plugin agent runtime, extended with a finance layer:

- **Data, one command away** — a Python environment with `akshare` (China equities / macro / news), `yfinance` (global equities, FX, commodities), `ccxt` (crypto exchanges) and `baostock`, created by [`finance/python/setup-env.sh`](finance/python/setup-env.sh) (the 680 MB venv itself is not committed, so a fresh clone starts without it).
- **Models, on demand** — nothing heavy is preinstalled. A built-in skill acts as a model map: when a task needs linear regression, gradient-boosted trees, LSTM/Transformer time-series models, or zero-shot forecasters (Chronos / TimesFM), the AI reads the map, installs the right package, and runs it.
- **Skills as manuals** — fourteen finance skills teach the AI *where* to get each kind of data, *which* model fits which task, how to backtest without fooling itself, and how to structure a research report.
- **AI-led, human-supervised** — the AI decides which sources to query, which tools to run, and when to search the web. Every step is visible and interruptible in the Web UI.

> Developer preview — expect breaking changes inherited from upstream. Review the [safety notice](SAFETY.md) before running.

> FinDeck's output is not investment advice. Read [SAFETY.md](SAFETY.md) before you run it.

## Download

Grab the Windows installer from [Releases](https://github.com/Dennisdan1104/FinDeck/releases) — the setup file is named `FinDeck.Setup.*.exe`.

It is unsigned, so SmartScreen warns about an "unknown publisher". That is expected for this build: click **More info → Run anyway**.

Once installed, the desktop app works as is. Nothing heavy is bundled — the Python data environment and the other large components download on demand from **Settings → Environment & components**, so you do not need to prepare them first.

To build from source or work on FinDeck itself, see the Quickstart below.

## Quickstart

<a id="run"></a>

<a id="run-from-source"></a>

Requirements: Node.js ≥ 22.19 (or ≥ 24), Python ≥ 3.10, pnpm ≥ 11.

```sh
git clone https://github.com/Dennisdan1104/FinDeck.git findeck && cd findeck
pnpm install
pnpm run build

# finance data environment (required for finance work)
bash finance/python/setup-env.sh          # Windows: powershell -ExecutionPolicy Bypass -File finance/python/setup-env.ps1

pnpm dsh web                              # opens http://127.0.0.1:3081
```

Then connect a model — see **[CONFIGURATION.md](CONFIGURATION.md)**. Keys are never bundled: every user brings their own (DeepSeek, any OpenAI-compatible gateway, or a local server).

FinDeck keeps itself separate from a stock DeepSeek Harness install: it serves on **port 3081** (not 3080) and stores its data under **`~/.findeck`** (not `~/.dsh`), so both can run side by side. On Windows start it with `start-findeck.ps1` (or `start-findeck.vbs`): the launcher pins `FINDECK_HOME`, and the resolver refuses a `DSH_HOME=~/.dsh` inherited from a stock-harness shell. See [CONFIGURATION.md](CONFIGURATION.md#数据目录home与端口).

## Conversation display

Settings → General offers one persisted four-mode preference for how a completed turn presents its process content; it lives in the `ui-chat` namespace and applies to every session.

| Mode | What it does |
|---|---|
| **Compact** | Folds a completed turn and hides the live command, path, or query detail from group titles |
| **Standard** (default) | Folds a completed turn and keeps that live detail in group titles |
| **Detailed** | Folds a completed turn, groups only its historical turns, and keeps the live detail |
| **Verbose** | No folding and no step grouping: every process row stays visible, with no turn-process control |

The preference accepts the earlier three-value form as well: `compact` keeps its name and meaning, and `grouped` reads as `standard`, `normal` as `verbose`, `expanded` as `detailed` through a fixed mapping, so an existing settings file keeps working; the stored value is rewritten the next time you pick a mode.

## Built-in skills

| Skill | What it teaches the AI |
|---|---|
| `findeck-research` | The master workflow: question → data → analysis → model → validation → report |
| `findeck-market-data-cn` | China market data via akshare (+ baostock fallback): OHLCV, financials, PE/PB, news, macro |
| `findeck-market-data-global` | Global data via yfinance and ccxt; FRED macro |
| `findeck-quant-models` | Model map: built-in toolbox (ridge/random-forest/LightGBM/ARIMA, one tunable interface) + on-demand neural nets |
| `findeck-backtesting` | vectorbt / backtrader templates, metric interpretation, look-ahead-bias checklist |
| `findeck-visualization` | Charts that actually display: the `charts` toolbox + read_image to render PNGs in the UI |
| `findeck-factor-analysis` | Factor testing: IC/RankIC, layered returns, collinearity, turnover |
| `findeck-portfolio` | Portfolio construction: equal/min-var/risk-parity/MVO + performance evaluation |
| `findeck-macro-playbook` | Macro playbooks: Merrill clock, rate transmission, credit cycle, policy tracking |
| `findeck-python-env` | The preinstalled venv: paths, pip mirrors, cache conventions, troubleshooting |
| `findeck-pipeline` | Asset pipelines: `pipeline.yaml` format, the step-script protocol (markers, params, output paths), manual runs and harness scheduling, and failure/version rules |
| `findeck-asset-face` | Generating an asset face: the eight block types, the per-kind good-face rules, storage and manifest declaration, and the `validate_face.py` gate |
| `findeck-workbench` | Work mode: the Work/Free test, the `workbench.yaml` format, the opening asset brief, and the run-and-report discipline |

Skills live in [`finance/skills/`](finance/skills/) as plain Markdown and are mounted through the harness skill system — add your own by dropping a new `SKILL.md` directory there.

## Five modes

A session starts in the mode its composition preset carries and can switch at any time: `/mode <preset id or name>`, or the composer's mode control, recomposes the agent from the target preset, whose tools, skills, prompt sections, persona, and sandbox rows replace the previous preset's from the next step on; the session log and transcript are untouched, so a resume rebuilds the composition the session actually ran under. The composer's `AI cluster` toggle sets the session-level cluster preference in every mode — a work mode's flow may declare cluster steps of its own, and the preference applies on top of them.

The five shipped presets are the roster below; the `mode_list` and `mode_write` tools let the agent author further modes, stored in the harness home's `.agent-presets/` directory, and a new mode copies its plugin composition from an existing one rather than inventing it. Two are work modes with declared flows: 研究模式 runs 规划 → 取数 → 分析建模 → 验证 → 报告, and 技能创作模式 (the mode the **Create from sessions** tab hands its transcripts to) runs 读转录 → 提炼 → 访谈确认 → 起草 → 校验落盘. The `flow_step` tool records each step the model enters into the session log that the step bar renders.

| Mode | Focus |
|---|---|
| **Research** | The full AI finance researcher (default) |
| **Deep Research** | Long-form thinking: decompose, hypothesize, cross-check, falsify, then conclude |
| **Minimal** | Shell + editor + the todo list, for quick scripts |
| **Creator** | Let the agent build custom finance components and presets for you |
| **Skill creation** | Distill past conversations into a reusable skill: read, distill, interview, draft, verify |

## Assets, workbenches, and review

- **Asset hub** — the `research-assets` page reads the global asset library: assets as a grid or a compact table, each version's `face.json` rendered block by block through the `runVerb` bridge, the lineage graph over the snapshot's dependency edges, the reports tab with its thesis strip, and the mode-flows tab; **Hand to AI** opens a new session seeded with an asset brief.
- **Workbenches (Work mode)** — a desk binds a set of archived assets to the conventions for running them. [`finance/workbenches/hs300-research.yaml`](finance/workbenches/hs300-research.yaml) is the shipped one: the session enters by name, runs the assets' declared verbs instead of rebuilding from scratch, and archives every change as a new version.
- **Roundtable** — several speaker identities over one shared transcript, with shipped or user-authored seatings, `shallow` and `deep` research depth, @-calls, interrupts, a table seeded from an existing session, and closed tables archived for `roundtable_list` and `roundtable_read`.
- **Red/blue adversarial review** — `/rb-check <report path|thesis id>` and the agent-callable `rb_check` inject a red-team attack followed by a blue-team defense into the running session; both prompts are editable settings.
- **Thesis tracking** — `thesis_list`, `thesis_show`, `thesis_write`, and `thesis_mark` turn a report's conclusion into a manifest with a metric, a due date, and a running hit/miss score.
- **Tool memory** — `memory_write`, `memory_read`, and `memory_list` keep durable notes in a global store and a per-project store.
- **Data & Environment and Help** — the sidebar's data-environment page probes the finance venv, its key modules, and the asset-library location; the Help page carries the quick-start path, the modes-and-flows explainer, and a feature map.
- **Desktop shell** — [`apps/desktop/`](apps/desktop/) is an Electron window over the local Web UI, with a tray icon, a global `Alt+Shift+D` hotkey, and opt-in autostart; it starts the same server as `start-findeck.ps1`, so closing the window leaves running sessions alone.

The finance layer's own inventory is [`finance/README.md`](finance/README.md); generated tool schemas are in [`docs/tool-catalog.md`](docs/tool-catalog.md).

## Project layout

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

## Attribution

FinDeck is a derivative of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT). Upstream trademark policy: [BRAND_GUIDELINES.md](BRAND_GUIDELINES.md). Data comes from public interfaces (EastMoney, Sina, Yahoo, crypto exchanges) through the excellent open-source libraries akshare / yfinance / ccxt / baostock — refer to each library's terms before redistributing data.

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
