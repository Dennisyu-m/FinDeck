# Changelog

English | [中文](CHANGELOG.zh.md)

## Source update — 2026-10-31

- Add host scheduling for asset pipelines, with cron and interval triggers, startup catch-up, and an independent automation switch.
- Add unattended value-desk tasks, deterministic signals, cumulative model budgets, cancellation, and four-section reports with a no-interpretation fallback.
- Add the value-desk page with task editing, run details, exact report-source versions, follow-up sessions, feedback, and scorecards; support creating Work definitions from selected assets.
- Drive plugin-owned navigation from registered sections and apply grouped plugin switches in one write.
- Fix Windows shell and sandbox issues, preserve task fields during editing, and repair host/client type analysis for documentation generation.
- This update publishes source changes. The existing desktop installer is unchanged.

## 1.0.0-alpha.1

The first FinDeck release on its own version line, no longer following the upstream DeepSeek Harness number sequence.

- Content baseline: forked from upstream `dsh-v0.1.3-alpha.1`, with features ported selectively from upstream up to roughly `dsh-v0.1.7-rc.2`.
- Ships the Windows desktop installer (NSIS, no separate Node.js installation) and the component download center.

## 0.1.3-alpha.1

Bootstrap publication, still carrying the upstream number sequence inherited at the fork point.
