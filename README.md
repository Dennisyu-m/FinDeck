# FinDeck

English | [中文](README.zh.md)

**FinDeck** is an open-source AI workspace for financial research. Run it locally, connect your own model, and use it to analyze data, maintain reusable research assets, and produce reports through conversations or scheduled tasks.

It is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT), an everything-is-a-plugin agent runtime, extended with a finance layer:

- **Research with data and models** — a separately installed Python environment provides `akshare`, `yfinance`, `ccxt`, `baostock`, and classic modeling tools; heavier model libraries are installed when a task needs them.
- **Reuse research assets** — keep datasets, models, tools, and reports as versioned assets, and group existing assets into a Work research setup.
- **Schedule repeatable work** — run declared asset pipelines on a schedule, or enable the unattended value desk to calculate signals and request AI interpretation.
- **Review the evidence** — inspect run records and recorded source versions, ask follow-up questions about reports, track theses, and use roundtable or red/blue review.

> Developer preview. APIs and stored formats may change. FinDeck's output is not investment advice; read the [safety notice](SAFETY.md) before running.

## Source and Windows download

| Distribution | Version | Contents |
|---|---|---|
| Current `master` source | `1.0.0-alpha.1` | Includes the 2026-10-31 automation and value-desk source update; follow Quickstart below to build it |
| [Windows installer](https://github.com/Dennisyu-m/FinDeck/releases/tag/v0.1.3-alpha.1) | `0.1.3-alpha.1` | The existing desktop build; it does not include the later source updates |

The installer has not been rebuilt for this source update. It bundles a Node.js runtime; the Python environment and other large components are downloaded through **Settings → Environment & components**. The installer is unsigned, so Windows may display a publisher warning. Every distribution requires your own model configuration.

## Quickstart

<a id="run"></a>

<a id="run-from-source"></a>

Requirements: Node.js ≥ 22.19 (or ≥ 24), Python ≥ 3.10, pnpm ≥ 11.

```sh
git clone https://github.com/Dennisyu-m/FinDeck.git findeck && cd findeck
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
| `findeck-desk` | Unattended value-desk runs: deterministic signals, four-section reports, recorded sources, and execution permissions |

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
- **Workbenches (Work mode)** — select assets in the asset hub to create a reusable research setup. A Work definition binds archived assets to their run conventions; the conversation runs their declared actions and archives changes as new versions. [`finance/workbenches/hs300-research.yaml`](finance/workbenches/hs300-research.yaml) is the shipped example and requires its referenced assets in the library.
- **Roundtable** — several speaker identities over one shared transcript, with shipped or user-authored seatings, `shallow` and `deep` research depth, @-calls, interrupts, a table seeded from an existing session, and closed tables archived for `roundtable_list` and `roundtable_read`.
- **Red/blue adversarial review** — `/rb-check <report path|thesis id>` and the agent-callable `rb_check` inject a red-team attack followed by a blue-team defense into the running session; both prompts are editable settings.
- **Thesis tracking** — `thesis_list`, `thesis_show`, `thesis_write`, and `thesis_mark` turn a report's conclusion into a manifest with a metric, a due date, and a running hit/miss score.
- **Tool memory** — `memory_write`, `memory_read`, and `memory_list` keep durable notes in a global store and a per-project store.
- **Data & Environment and Help** — the sidebar's data-environment page probes the finance venv, its key modules, and the asset-library location; the Help page carries the quick-start path, the modes-and-flows explainer, and a feature map.
- **Desktop shell** — [`apps/desktop/`](apps/desktop/) is an Electron window over the local Web UI, with a tray icon, a global `Alt+Shift+D` hotkey, and opt-in autostart; it starts the same server as `start-findeck.ps1`, so closing the window leaves running sessions alone.

The finance layer's own inventory is [`finance/README.md`](finance/README.md); generated tool schemas are in [`docs/tool-catalog.md`](docs/tool-catalog.md).

## Scheduled tasks and value desk

| Entry | Who runs the work | Result |
|---|---|---|
| Scheduled tasks | The program executes declared pipeline steps, without model interpretation | Updated assets and pipeline run records |
| Work mode | You work with the AI in a conversation over selected assets | Interactive analysis and new asset versions |
| Value desk | The program computes signals; the AI interprets a task when required | Run details, reports, follow-up sessions, and feedback |

Open **Settings → Automation** to control scheduled tasks and the value desk independently. Scheduled tasks are enabled by default; the value desk is disabled by default and requires a configured model and the finance Python environment. A new task must use assets available in your library. The host process must stay running for unattended work.

The value-desk page provides task editing, enable/disable, run now, cancel, and run/report history. Reports have four sections: key points, signal interpretation, thesis rechecks, and decisions for you. Failed AI interpretation can produce a no-interpretation report from the signal results. Feedback and scorecards describe research activity; they do not measure investment returns. Configuration is documented in [CONFIGURATION.md](CONFIGURATION.md#自动化与会话提醒), and the service reference is [Value desk](docs/subsystems/desk.md).

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
