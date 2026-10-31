# FinDeck Finance Layer

English | [中文](README.zh.md)

This directory provides FinDeck's financial data environment, research skills, asset tools, and reusable task definitions. For the product overview and the difference between current source and the downloadable installer, see the [root README](../README.md).

| Path | Contents |
|---|---|
| `skills/` | The AI's "manuals" (14), mounted into every session |
| `pipelines/` | Scheduled asset pipelines (`<name>.yaml` definitions + step scripts): `daily-refresh` (panel → model → report) and `weekly-healthcheck` (asset health report) |
| `face-spec/` | Asset-face spec: `face.schema.json` + `validate_face.py` + examples, and `verb-bridge.md`, the protocol the face uses to run library verbs |
| `workbenches/` | Shipped Work-mode definitions (`<name>.yaml`): a named asset set plus its run conventions, read by `python -m findeck.workbench` (`list`/`show`/`validate`); user-created definitions live in `<harness home>/workbenches/` and shadow a shipped name |
| `python/findeck/` | Built-in toolkit modules: `assets` (global asset library), `background` (detached run records shared by the `verb_bridge` and `pipeline` CLIs), `charts` (chart factory), `desk` (task validation, deterministic signals, report archiving), `pipeline` (pipeline.yaml validator/executor), `quickmodels` (unified modeling), `snapshot` (data snapshots), `verb_bridge` (face verb execution bridge), `workbench` (workbench.yaml validator and brief generator) |
| `python/.venv/` | Data environment (created by the setup scripts; registers the findeck package via `.pth`) |
| `python/requirements-data.txt` | Preinstalled list, with upper bounds (data + sklearn/lightgbm/statsmodels) |
| `python/setup-env.ps1` / `.sh` | Idempotent bootstrap (Tsinghua mirror first, `FD_PIP_INDEX` overrides) |
| `python/smoke-test.py` | Data source health check (PASS when any domestic source works) |
| `python/test-toolbox.py` | Toolkit regression test (models + charts + snapshots + assets) |
| `python/migrate-assets.py` | One-off registration of the existing `data/` parquet files as `dataset` assets; idempotent and rerunnable |
| `experiments/` | Repeatable experiments (A/B validation of the iteration-correction idea) |
| `README.md` | This file |

## Design principles

1. **Data and classic models preinstalled, heavy models on demand.** Data fetching plus
   ridge/random-forest/LightGBM/ARIMA (sklearn/lightgbm/statsmodels, through the unified
   `findeck` toolkit where the AI tunes via `params`); PyTorch-scale stacks (several GB)
   are installed per task, with the model-map skill as the guide.
2. **Skills only point the way; they don't ship payloads.** Every skill is plain Markdown:
   interface names, parameters, code templates, and known pitfalls. The AI can act after
   reading, and humans can read and maintain them directly.
3. **Compose finance capabilities as plugins.** Bundles mount the finance skills and asset, thesis, memory, and review services. A shared host scheduler runs pipelines and desk tasks, and a dedicated `desk` profile composes unattended execution. Composition and extension points are documented in [the architecture guide](../docs/architecture.md).

## Research and automation entry points

| Entry | Definition | Use |
|---|---|---|
| Asset pipeline | `finance/pipelines/*.yaml` and referenced step scripts | Repeat declared processing steps and archive their outputs |
| Work research setup | Shipped `finance/workbenches/*.yaml` or user definitions under `<home>/workbenches/` | Reuse selected assets in an interactive research conversation |
| Value-desk task | User definitions under `<home>/desk/tasks/` | Calculate signals and produce unattended research reports |

The shared scheduler and desk service run inside the Web host. Configure the independent switches through [Automation settings](../CONFIGURATION.md#自动化与会话提醒). Task management, report records, feedback, and limitations are documented in the [value-desk reference](../docs/subsystems/desk.md).

## Skills

| Skill | Role |
|---|---|
| `findeck-research` | Master SOP: research workflow + iteration-correction protocol + report template + disciplines |
| `findeck-market-data-cn` | A-shares/HK/macro/news (akshare, baostock fallback) |
| `findeck-market-data-global` | US/global/crypto (yfinance, ccxt), FRED |
| `findeck-quant-models` | Model map: built-in toolkit usage + on-demand neural nets + evaluation discipline |
| `findeck-backtesting` | vectorbt/backtrader templates + metric reading + pitfall list |
| `findeck-visualization` | Charting rules: charts toolkit + the read_image display path |
| `findeck-factor-analysis` | Factor testing: IC/layering/collinearity/turnover |
| `findeck-portfolio` | Portfolio construction: equal-weight/min-variance/risk-parity/MVO |
| `findeck-macro-playbook` | Macro playbooks: Merrill clock / rate transmission / credit cycle / policy |
| `findeck-python-env` | Data environment manual (paths/mirrors/caches/troubleshooting) |
| `findeck-pipeline` | Asset pipelines: `pipeline.yaml` format, step marker protocol, manual run, automation-runner scheduling from the yaml trigger, failure semantics |
| `findeck-asset-face` | Generating an asset face: the 8-component vocabulary, per-kind "good face" rules, storage + manifest declaration, validator gate |
| `findeck-workbench` | Work-mode operation: the `workbench.yaml` format, the opening asset brief, and the run-and-report discipline |
| `findeck-desk` | Value-desk run discipline: read the deterministic signal table, leave the four-section report, and never exceed the execution permission |

## Data environment

```bash
bash finance/python/setup-env.sh                 # Linux/macOS/Git-Bash
powershell -ExecutionPolicy Bypass -File finance/python/setup-env.ps1   # Windows
```

This creates `finance/python/.venv` (preinstalled list in `requirements-data.txt`; the setup
script registers the `findeck` package into the venv via `.pth`). The script is idempotent,
defaults to the Tsinghua mirror (`FD_PIP_INDEX` overrides), and falls back to the official
index on failure.

Toolkit regression: `finance/python/.venv/Scripts/python.exe finance/python/test-toolbox.py`
(runs models + charts + snapshot discipline + asset-library round-trip). The script reuses the
`data/market_cn_600519_daily_bs.parquet` cache when present; otherwise it fetches 600519 daily
bars from akshare once and writes that cache, and falls back to a deterministic synthetic OHLCV
fixture when the network is unavailable. It prints which path it took.

After setup, run the smoke test: `finance/python/.venv/Scripts/python.exe finance/python/smoke-test.py`
(fetches real data from every source; PASS when any domestic source works; offshore sources
are informational).

## Asset library and data snapshots

- **Snapshots (R8)**: `from findeck import snapshot` — `load_or_fetch` reuses the same-day
  snapshot for identical parameters and archives every real fetch to
  `data/snapshot_<source>_<digest>_<date>.parquet`; `FINDECK_SNAPSHOT=0` disables.
- **Asset library (R2)**: `from findeck import assets` — `archive` validates the manifest
  (all required fields), stores versions side by side (never overwritten), and rebuilds
  `index.md` + `index.json`. The seven tools in `packages/skill/tool-asset-library` (`asset_dir`,
  `asset_list`, `asset_search`, `asset_show`, `asset_graph`, `asset_run`, `asset_run_bg`) expose
  that library to a session; the [tool catalog](../docs/tool-catalog.md) documents each. Archiving
  discipline: `findeck-research` step 8.

Manifest v2 adds six fields — `origin` (agent/user/imported), `verbs` (declared actions; no verbs, no
archive), `freshness` (`as_of` + `update_frequency`, required for datasets), `lineage` (`producer`
script/params/session + `inputs`), `tags`, and `face` (a `face.json` path inside the version
directory) — and `index.json` v2 summarises all of them per asset and per version. New sessions find
assets with `asset_search` (kind/origin/tag/verb/keyword/freshness), which reads that index.
Pipelines archive through the same door: each produced version gets `version = max + 1`, an
auto-filled `supersedes`, `origin='agent'`, `depends_on`/`lineage.inputs` from the step's `inputs`,
and `lineage.producer = {script, params, session}`, so the lineage chain accumulates while the step
script writes no manifest. The `weekly-healthcheck` pipeline probes every dataset with its `preview`
verb, flags stale `freshness.as_of` dates and assets untouched for 90 days, and archives the outcome
as the report asset `asset-health-report`; touches come from `usage.jsonl` (written by the asset
tools) plus `pipeline-runs/*.jsonl`.

## Maintenance notes

- akshare interfaces churn fastest: when one breaks, update the table in
  `findeck-market-data-cn` after checking the latest parameters against the
  [akshare docs](https://akshare.akfamily.xyz/).
- When the model ecosystem shifts (new time-series foundation models and so on), update the
  repository table in `findeck-quant-models`.
- Every skill's YAML frontmatter must carry `name` (kebab-case) and `description`; the description is bilingual — Chinese first, then `English:` — per the [description language rule](../docs/subsystems/skills.md#description-language).
