"""值班任务：定义校验、确定性信号、四段式报告归档与无解读版降级。

一份任务描述盯什么、何时跑、何时出报告、花多少预算。关注对象写在任务自己的
``targets`` 里，不另设全局关注列表。本模块不调度；调度与模型会话由宿主执行器
（``@deepseek-ai/dsh-automation-runner``）负责，本模块只执行确定性的两步：算信号、
把报告归档为资产。

定义格式::

    name: morning-watch              # kebab-case，必须与文件名一致
    display_name: 晨间盯盘
    goal: 盯茅台隔夜是否出现异动
    enabled: true                    # 可选，缺省 true；false 时执行器不排期
    targets:                         # 非空；关注对象
      - { kind: symbol, ref: cn:600519 }
      - { kind: symbol, ref: us:AAPL }
      - { kind: theme, ref: 白酒 }
      - { kind: thesis, ref: maotai-premium }
      - { kind: asset, ref: hs300-daily-report }
      - { kind: workbench, ref: hs300-research }
      - { kind: asset, ref: hs300-monthly-panel,
          refresh: { kind: verb, asset: hs300-monthly-panel, verb: update } }
    trigger:                         # 非空列表，可组合
      - { kind: cron, schedule: "0 8 * * 1-5" }
      - { kind: interval, everySeconds: 3600 }
      - { kind: event, name: github }
      - { kind: thesis-due }
    report: always                   # always 每次都出；changes 只在有异动时出
    budget:
      tokens: 20000                  # 整次运行的累计 token 预算
      wallSeconds: 600               # 墙钟上限（秒）
      maxOutputTokens: 2048          # 可选；单次模型请求的输出上限
    proposed_by: user                # 本代只接受 user

校验规则（全部 fail loud，未知键一律拒绝）：顶层键 ⊆
``{name, display_name, goal, enabled, targets, trigger, report, budget, proposed_by}``。
``symbol`` 的 ref 为 ``cn:`` 加 6 位数字或 ``us:`` 加大写字母；``theme`` 的 ref 为非空字符串；
``thesis`` / ``asset`` / ``workbench`` 的 ref 为 kebab-case。``trigger`` 的 cron 为 5 段表达式，
``event.name`` 是已认证 webhook 适配器的 kind（kebab-case）。``refresh`` 可选，形如
``{kind: verb, asset, verb}`` 或 ``{kind: pipeline, name}``；它声明该关注对象的刷新方式，
执行信号前按声明运行库内资产 verb 或流水线。``proposed_by: bot`` 本代拒绝。

``run`` 做确定性的信号计算：标的到资产库最新版本的 parquet 里找收盘价和成交量，
有两根 K 线就给出涨跌幅；绝对涨跌幅达到阈值或成交量达到上一根的阈值倍数记为异动。
资产、命题、workbench 只读取库内已存在的版本与定义；找不到数据来源记
「缺少数据来源」，不编造数字。阈值来自执行器配置（CLI 参数）。结果以一行
``step: signal`` 记录追加到运行目录，并带上 ``runId``、触发来源、输入资产版本。

``archive-report`` 把报告落成 ``kind: report``、``tags: [desk, <任务名>]`` 的资产版本，
四段固定为要点（≤5 条）、异动解读、命题复检、待你决策；来源版本取自本次运行的信号记录，
不由模型填写。``--payload`` 里的 ``fallback: true`` 生成无解读版。

CLI::

    python -m findeck.desk validate path/to/morning-watch.yaml
    python -m findeck.desk run path/to/morning-watch.yaml --run-id <id> --runs-dir <dir>
    python -m findeck.desk archive-report --task morning-watch --run-id <id> \
        --runs-dir <dir> --payload <payload.json>
    python -m findeck.desk list
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import date, datetime
from pathlib import Path

import yaml

from . import assets, workbench

__all__ = [
    'load', 'validate', 'run', 'archive_report', 'list_tasks',
    'tasks_dir', 'runs_dir', 'harness_home', 'find_signal_record',
]

_KEBAB_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
_SYMBOL_RE = re.compile(r'^(cn:\d{6}|us:[A-Z]{1,8})$')
_CRON_FIELD_RE = re.compile(r'^[0-9A-Za-z*/,?-]+$')

_TOP_KEYS = {'name', 'display_name', 'goal', 'enabled', 'targets', 'trigger', 'report', 'budget',
             'proposed_by'}
_TARGET_KINDS = ('symbol', 'theme', 'thesis', 'asset', 'workbench')
_TARGET_KEYS = {'kind', 'ref', 'refresh'}
_REFRESH_KINDS = ('verb', 'pipeline')
_TRIGGER_KINDS = ('cron', 'interval', 'event', 'thesis-due')
_TRIGGER_KEYS = {'kind', 'schedule', 'everySeconds', 'name'}
_BUDGET_KEYS = {'tokens', 'wallSeconds', 'maxOutputTokens'}
_REPORTS = ('always', 'changes')

_DEFAULT_MOVE_PCT = 0.03
_DEFAULT_VOLUME_RATIO = 2.0
_DEFAULT_FRESHNESS_MAX_AGE_DAYS = 7
_REPORT_SECTION_MAX_CHARS = 20000
_REPORT_POINT_MAX_CHARS = 2000


def harness_home() -> Path:
    """Harness 家目录。``FINDECK_HOME`` 优先，其次 ``ALPHADECK_HOME``、``DSH_HOME``，否则 ``~/.findeck``。

    ``DSH_HOME`` 指向 ``~/.dsh`` 时忽略，与宿主的家目录选择一致。
    """
    for key in ('FINDECK_HOME', 'ALPHADECK_HOME', 'DSH_HOME'):
        value = os.environ.get(key)
        if not value:
            continue
        path = Path(value).expanduser()
        if key == 'DSH_HOME' and path.name == '.dsh':
            continue
        return path
    return Path.home() / '.findeck'


def _home_dir(kind: str) -> Path:
    """任务或运行记录目录；``FINDECK_DESK_DIR`` 可整体改掉 ``<家目录>/desk``。"""
    override = os.environ.get('FINDECK_DESK_DIR')
    base = Path(override).expanduser() if override else harness_home() / 'desk'
    return base / kind


def tasks_dir() -> Path:
    """值班任务目录：``<家目录>/desk/tasks``。"""
    return _home_dir('tasks')


def runs_dir() -> Path:
    """值班运行记录目录：``<家目录>/desk/runs``。"""
    return _home_dir('runs')


def load(path: str | Path) -> dict:
    """读入一份值班任务 yaml 并返回顶层映射。

    :raises ValueError: 文件不存在、YAML 解析失败或顶层不是映射。
    """
    p = Path(path)
    if not p.is_file():
        raise ValueError(f'值班任务文件不存在: {p}')
    try:
        raw = yaml.safe_load(p.read_text(encoding='utf-8'))
    except yaml.YAMLError as e:
        raise ValueError(f'值班任务 YAML 解析失败: {p}: {e}') from e
    if not isinstance(raw, dict):
        raise ValueError(f'值班任务顶层必须是映射（key: value）: {p}')
    return raw


def _positive_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _check_refresh(index: int, refresh, errors: list[str]) -> None:
    where = f'targets[{index}].refresh'
    if not isinstance(refresh, dict):
        errors.append(f'{where} 必须是对象: {refresh!r}')
        return
    kind = refresh.get('kind')
    if kind == 'verb':
        unknown = sorted(set(refresh) - {'kind', 'asset', 'verb'})
        if unknown:
            errors.append(f'{where} 出现未知字段 {unknown}（允许: kind, asset, verb）')
        if not isinstance(refresh.get('asset'), str) or not _KEBAB_RE.match(refresh['asset']):
            errors.append(f'{where}.asset 必须是 kebab-case 资产名: {refresh.get("asset")!r}')
        if not isinstance(refresh.get('verb'), str) or not _KEBAB_RE.match(refresh['verb']):
            errors.append(f'{where}.verb 必须是 kebab-case verb 名: {refresh.get("verb")!r}')
        return
    if kind == 'pipeline':
        unknown = sorted(set(refresh) - {'kind', 'name'})
        if unknown:
            errors.append(f'{where} 出现未知字段 {unknown}（允许: kind, name）')
        if not isinstance(refresh.get('name'), str) or not _KEBAB_RE.match(refresh['name']):
            errors.append(f'{where}.name 必须是 kebab-case 流水线名: {refresh.get("name")!r}')
        return
    errors.append(f'{where}.kind 必须是 {_REFRESH_KINDS} 之一: {kind!r}')


def _check_target(index: int, target, errors: list[str]) -> None:
    where = f'targets[{index}]'
    if not isinstance(target, dict):
        errors.append(f'{where} 必须是对象: {target!r}')
        return
    unknown = sorted(set(target) - _TARGET_KEYS)
    if unknown:
        errors.append(f'{where} 出现未知字段 {unknown}（允许: {sorted(_TARGET_KEYS)}）')
    kind = target.get('kind')
    ref = target.get('ref')
    if kind not in _TARGET_KINDS:
        errors.append(f'{where}.kind 必须是 {_TARGET_KINDS} 之一: {kind!r}')
        return
    if kind == 'symbol' and (not isinstance(ref, str) or not _SYMBOL_RE.match(ref)):
        errors.append(f'{where}.ref 必须是 cn:600519 或 us:AAPL 这种标的: {ref!r}')
    elif kind == 'theme' and (not isinstance(ref, str) or not ref.strip()):
        errors.append(f'{where}.ref 必须是非空主题: {ref!r}')
    elif kind in ('thesis', 'asset', 'workbench') and (
            not isinstance(ref, str) or not _KEBAB_RE.match(ref)):
        errors.append(f'{where}.ref 必须是 kebab-case: {ref!r}')
    if 'refresh' in target:
        _check_refresh(index, target['refresh'], errors)


def _check_targets(targets, errors: list[str]) -> None:
    if not isinstance(targets, list) or not targets:
        errors.append(f'targets 必须是非空列表: {targets!r}')
        return
    for index, target in enumerate(targets):
        _check_target(index, target, errors)


def _cron_ok(schedule) -> bool:
    if not isinstance(schedule, str):
        return False
    fields = schedule.split()
    return len(fields) == 5 and all(_CRON_FIELD_RE.match(field) for field in fields)


def _check_trigger_item(index: int, item, errors: list[str]) -> None:
    where = f'trigger[{index}]'
    if not isinstance(item, dict):
        errors.append(f'{where} 必须是对象: {item!r}')
        return
    unknown = sorted(set(item) - _TRIGGER_KEYS)
    if unknown:
        errors.append(f'{where} 出现未知字段 {unknown}（允许: {sorted(_TRIGGER_KEYS)}）')
    kind = item.get('kind')
    if kind not in _TRIGGER_KINDS:
        errors.append(f'{where}.kind 必须是 {_TRIGGER_KINDS} 之一: {kind!r}')
        return
    if kind == 'cron':
        if not _cron_ok(item.get('schedule')):
            errors.append(f'{where}.schedule 必须是 5 段 cron 表达式: {item.get("schedule")!r}')
        for extra in ('everySeconds', 'name'):
            if extra in item:
                errors.append(f'{where}.kind=cron 时不应声明 {extra}')
    elif kind == 'interval':
        if not _positive_int(item.get('everySeconds')):
            errors.append(f'{where}.everySeconds 必须是正整数（秒）: {item.get("everySeconds")!r}')
        for extra in ('schedule', 'name'):
            if extra in item:
                errors.append(f'{where}.kind=interval 时不应声明 {extra}')
    elif kind == 'event':
        name = item.get('name')
        if not isinstance(name, str) or not _KEBAB_RE.match(name):
            errors.append(f'{where}.name 必须是 kebab-case（webhook 适配器的 kind）: {name!r}')
        for extra in ('schedule', 'everySeconds'):
            if extra in item:
                errors.append(f'{where}.kind=event 时不应声明 {extra}')
    else:
        for extra in ('schedule', 'everySeconds', 'name'):
            if extra in item:
                errors.append(f'{where}.kind=thesis-due 时不应声明 {extra}')


def _check_trigger(trigger, errors: list[str]) -> None:
    if not isinstance(trigger, list) or not trigger:
        errors.append(f'trigger 必须是非空列表（可组合 cron / interval / event / thesis-due）: {trigger!r}')
        return
    for index, item in enumerate(trigger):
        _check_trigger_item(index, item, errors)


def _check_budget(budget, errors: list[str]) -> None:
    if not isinstance(budget, dict):
        errors.append(f'budget 必须是对象: {budget!r}')
        return
    unknown = sorted(set(budget) - _BUDGET_KEYS)
    if unknown:
        errors.append(f'budget 出现未知字段 {unknown}（允许: {sorted(_BUDGET_KEYS)}）')
    if not _positive_int(budget.get('tokens')):
        errors.append(f'budget.tokens 必须是正整数: {budget.get("tokens")!r}')
    if not _positive_int(budget.get('wallSeconds')):
        errors.append(f'budget.wallSeconds 必须是正整数（秒）: {budget.get("wallSeconds")!r}')
    if 'maxOutputTokens' in budget and not _positive_int(budget.get('maxOutputTokens')):
        errors.append(f'budget.maxOutputTokens 必须是正整数（省略表示用执行器默认值）: '
                      f'{budget.get("maxOutputTokens")!r}')


def validate(path: str | Path) -> dict:
    """校验一份值班任务 yaml，通过则返回它，失败则把所有错误一次性汇总抛出。

    :raises ValueError: 每行一条中文错误，指明具体字段（fail loud，不做静默兜底）。
    """
    p = Path(path)
    spec = load(p)
    errors: list[str] = []
    unknown = sorted(set(spec) - _TOP_KEYS)
    if unknown:
        errors.append(f'顶层出现未知字段 {unknown}（允许: {sorted(_TOP_KEYS)}）')
    name = spec.get('name')
    if not isinstance(name, str) or not _KEBAB_RE.match(name):
        errors.append(f'name 必须是 kebab-case 字符串: {name!r}')
    elif p.stem != name:
        errors.append(f'name 必须与文件名一致: name={name!r}，文件名={p.stem!r}')
    for key in ('display_name', 'goal'):
        if not isinstance(spec.get(key), str) or not spec[key].strip():
            errors.append(f'{key} 必填且为非空字符串: {spec.get(key)!r}')
    if 'enabled' in spec and not isinstance(spec['enabled'], bool):
        errors.append(f'enabled 必须是布尔值: {spec["enabled"]!r}')
    _check_targets(spec.get('targets'), errors)
    _check_trigger(spec.get('trigger'), errors)
    targets = spec.get('targets')
    triggers = spec.get('trigger')
    if isinstance(targets, list) and isinstance(triggers, list):
        thesis_refs = {t.get('ref') for t in targets
                       if isinstance(t, dict) and t.get('kind') == 'thesis' and isinstance(t.get('ref'), str)}
        if any(isinstance(t, dict) and t.get('kind') == 'thesis-due' for t in triggers) and not thesis_refs:
            errors.append('trigger 含 thesis-due 时必须至少有一个 kind=thesis 的 targets，'
                          '否则到期命题无法限定到本任务')
    report = spec.get('report')
    if report not in _REPORTS:
        errors.append(f'report 必须是 always（每次都出）或 changes（只在有异动时出）: {report!r}')
    _check_budget(spec.get('budget'), errors)
    proposed = spec.get('proposed_by')
    if proposed == 'bot':
        errors.append('proposed_by=bot 本代不生效：bot 提议须经批准，本代只接受 user')
    elif proposed != 'user':
        errors.append(f'proposed_by 必须是 user: {proposed!r}')
    if errors:
        listed = '\n'.join(f'  - {e}' for e in errors)
        raise ValueError(f'值班任务定义非法（{p}）:\n{listed}')
    return spec


def _local_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


def _symbol_keys(ref: str) -> set[str]:
    """标的在行情表里可能出现的写法。A 股比数字，美股比大写代码。"""
    market, raw = ref.split(':', 1)
    if market == 'cn':
        return {raw}
    return {raw.upper()}


def _cell_key(value: object, market: str) -> str:
    text = str(value).strip().upper()
    if market == 'cn':
        digits = ''.join(ch for ch in text if ch.isdigit())
        return digits[-6:] if len(digits) >= 6 else digits
    letters = ''.join(ch for ch in text if ch.isalpha())
    return letters


def _latest_parquets() -> list[tuple[str, int, Path]]:
    """每个资产最新版本目录下的 parquet。"""
    root = assets.asset_root()
    found: list[tuple[str, int, Path]] = []
    if not root.is_dir():
        return found
    for asset_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        versions = [int(path.name[1:]) for path in asset_dir.iterdir()
                    if path.is_dir() and path.name.startswith('v') and path.name[1:].isdigit()]
        if not versions:
            continue
        version = max(versions)
        latest = asset_dir / f'v{version}'
        found.extend((asset_dir.name, version, path) for path in sorted(latest.rglob('*.parquet')))
    return found


def _symbol_rows(ref: str):
    """在资产库里找到该标的的行情行，按日期升序。找不到返回 None。"""
    import pandas as pd

    market = ref.split(':', 1)[0]
    keys = _symbol_keys(ref)
    for asset, version, path in _latest_parquets():
        try:
            frame = pd.read_parquet(path)
        except (OSError, ValueError):
            continue
        columns = {str(name).lower(): name for name in frame.columns}
        close_col = columns.get('close')
        code_col = columns.get('code') or columns.get('symbol')
        if close_col is None or code_col is None:
            continue
        mask = frame[code_col].map(lambda value: _cell_key(value, market) in keys)
        rows = frame.loc[mask].copy()
        if rows.empty:
            continue
        date_col = columns.get('date')
        if date_col is not None:
            rows = rows.sort_values(date_col)
        rows = rows.rename(columns={close_col: 'close'})
        if columns.get('volume') is not None:
            rows = rows.rename(columns={columns['volume']: 'volume'})
        as_of = None
        if date_col is not None and len(rows) > 0:
            as_of = str(rows.iloc[-1][date_col])[:10]
        return asset, version, rows, as_of
    return None


def _symbol_signal(ref: str, move_pct: float, volume_ratio: float) -> dict:
    try:
        found = _symbol_rows(ref)
    except ImportError:
        return {'kind': 'symbol', 'ref': ref, 'status': 'stale', 'note': '数据未更新（缺少 pandas）'}
    if found is None:
        return {'kind': 'symbol', 'ref': ref, 'status': 'stale', 'note': '数据未更新'}
    asset, version, rows, as_of = found
    last = rows.iloc[-1]
    close = float(last['close'])
    change = None
    volume = None
    if len(rows) > 1:
        prev = rows.iloc[-2]
        previous_close = float(prev['close'])
        if previous_close != 0:
            change = (close - previous_close) / previous_close
        if 'volume' in rows.columns:
            previous_volume = float(prev['volume'])
            if previous_volume > 0:
                volume = float(last['volume']) / previous_volume
    move = (change is not None and abs(change) >= move_pct) or (
        volume is not None and volume >= volume_ratio)
    return {
        'kind': 'symbol',
        'ref': ref,
        'status': 'move' if move else 'quiet',
        'asset': asset,
        'version': version,
        'asOf': as_of,
        'close': close,
        'change': None if change is None else round(change, 6),
        'volumeRatio': None if volume is None else round(volume, 3),
        'thresholds': {'movePct': move_pct, 'volumeRatio': volume_ratio},
    }


def _freshness_days(as_of: str | None, today: date) -> int | None:
    if not as_of:
        return None
    try:
        return (today - date.fromisoformat(as_of[:10])).days
    except ValueError:
        return None


def _asset_index() -> dict[str, dict]:
    """资产名到最新版本摘要；索引缺失时退回扫库。索引损坏按空库处理，不编造数据。"""
    root = assets.asset_root()
    index = root / 'index.json'
    if index.is_file():
        try:
            data = json.loads(index.read_text(encoding='utf-8'))
            return {entry['name']: entry for entry in data.get('assets', [])}
        except (OSError, ValueError, KeyError, TypeError):
            return {}
    return {entry['name']: entry for entry in assets.list_all()}


def _asset_signal(ref: str, max_age_days: int, today: date) -> dict:
    entry = _asset_index().get(ref)
    if entry is None:
        return {'kind': 'asset', 'ref': ref, 'status': 'missing-source', 'note': '资产库中没有这个资产'}
    freshness = entry.get('freshness') or {}
    as_of = freshness.get('as_of')
    age = _freshness_days(as_of, today)
    stale = age is not None and age > max_age_days
    signal = {
        'kind': 'asset',
        'ref': ref,
        'status': 'stale' if stale else 'recorded',
        'asset': ref,
        'version': entry['latest_version'],
        'assetKind': entry.get('kind'),
        'verbs': entry.get('verbs') or [],
        'asOf': as_of,
        'ageDays': age,
        'freshnessStale': stale,
    }
    if entry.get('kind') == 'dataset' and as_of is None:
        signal['note'] = '数据集未声明 freshness.as_of'
    elif stale:
        signal['note'] = f'数据已 {age} 天未更新（上限 {max_age_days} 天）'
    return signal


def _thesis_signal(ref: str, today: date) -> dict:
    path = assets.asset_root() / 'theses' / f'{ref}.yaml'
    if not path.is_file():
        return {'kind': 'thesis', 'ref': ref, 'status': 'missing-source', 'note': '命题未登记'}
    try:
        manifest = yaml.safe_load(path.read_text(encoding='utf-8'))
    except (OSError, yaml.YAMLError) as e:
        return {'kind': 'thesis', 'ref': ref, 'status': 'missing-source', 'note': f'命题无法读取: {e}'}
    if not isinstance(manifest, dict):
        return {'kind': 'thesis', 'ref': ref, 'status': 'missing-source', 'note': '命题文件不是映射'}
    checks = manifest.get('checks') or []
    last = checks[-1] if isinstance(checks, list) and checks else None
    status = 'open'
    if isinstance(last, dict) and last.get('outcome') in ('hit', 'miss'):
        status = last['outcome']
    due = str(manifest.get('due_date') or '')
    checked_after_due = isinstance(checks, list) and any(
        isinstance(check, dict) and str(check.get('checked_at', ''))[:10] >= due and due
        for check in checks)
    overdue = bool(due) and not checked_after_due and due < today.isoformat()
    return {
        'kind': 'thesis',
        'ref': ref,
        'status': 'due' if overdue else 'recorded',
        'thesisStatus': status,
        'conclusion': manifest.get('conclusion'),
        'metric': manifest.get('metric'),
        'threshold': manifest.get('threshold'),
        'dueDate': due,
        'overdue': overdue,
        'checkCount': len(checks) if isinstance(checks, list) else 0,
    }


def _workbench_signal(ref: str) -> dict:
    try:
        spec = workbench.validate(ref)
    except (ValueError, KeyError) as e:
        return {'kind': 'workbench', 'ref': ref, 'status': 'missing-source',
                'note': f'workbench 不可用: {e}'}
    index = _asset_index()
    assets_brief = []
    inputs = []
    for name in spec['assets']:
        entry = index.get(name)
        if entry is None:
            assets_brief.append({'name': name, 'missing': True})
            continue
        assets_brief.append({
            'name': name,
            'version': entry['latest_version'],
            'kind': entry.get('kind'),
            'verbs': entry.get('verbs') or [],
            'asOf': (entry.get('freshness') or {}).get('as_of'),
        })
        inputs.append({'asset': name, 'version': entry['latest_version'], 'kind': entry.get('kind')})
    return {
        'kind': 'workbench',
        'ref': ref,
        'status': 'recorded',
        'displayName': spec.get('display_name'),
        'description': spec.get('description'),
        'workbenchAssets': assets_brief,
        'conventions': spec.get('conventions'),
        'resolvedInputs': inputs,
    }


def _theme_signal(ref: str) -> dict:
    return {'kind': 'theme', 'ref': ref, 'status': 'missing-source',
            'note': '主题没有确定性数据来源；请在目标上声明 refresh，或改用资产/标的'}


def _run_refresh(target: dict) -> dict | None:
    """按关注对象声明的刷新方式执行一次；返回结果行，没有声明返回 None。"""
    refresh = target.get('refresh')
    if not refresh:
        return None
    declared = {'target': target.get('ref'), 'kind': target.get('kind'),
                'refreshKind': refresh.get('kind')}
    try:
        if refresh['kind'] == 'verb':
            from . import verb_bridge
            response = verb_bridge.execute({
                'asset': refresh['asset'], 'verb': refresh['verb'], 'params': {},
            })
            if response.get('status') != 'ok':
                return {**declared, 'status': 'failed', 'error': response.get('error') or 'verb 执行失败'}
            return {**declared, 'status': 'ok', 'asset': refresh['asset'],
                    'verb': refresh['verb'], 'duration_s': response.get('duration_s')}
        from . import pipeline
        path = workbench.repo_root() / 'finance' / 'pipelines' / f'{refresh["name"]}.yaml'
        steps = pipeline.run(path)
        failed = [step for step in steps if step.get('status') not in ('ok', 'skipped')]
        if failed:
            return {**declared, 'status': 'failed',
                    'error': f'流水线 {refresh["name"]} 有失败步骤: {failed[0].get("step")}'}
        return {**declared, 'status': 'ok', 'pipeline': refresh['name'], 'steps': len(steps)}
    except (ValueError, FileNotFoundError, RuntimeError, OSError) as e:
        return {**declared, 'status': 'failed', 'error': str(e)}


def _signals(spec: dict, move_pct: float, volume_ratio: float, max_age_days: int) -> dict:
    today = date.today()
    signals = []
    refresh = []
    inputs: list[dict] = []
    for target in spec['targets']:
        refreshed = _run_refresh(target)
        if refreshed is not None:
            refresh.append(refreshed)
        kind = target['kind']
        if kind == 'symbol':
            signal = _symbol_signal(target['ref'], move_pct, volume_ratio)
        elif kind == 'asset':
            signal = _asset_signal(target['ref'], max_age_days, today)
        elif kind == 'thesis':
            signal = _thesis_signal(target['ref'], today)
        elif kind == 'workbench':
            signal = _workbench_signal(target['ref'])
            inputs.extend(signal.pop('resolvedInputs', []))
        else:
            signal = _theme_signal(target['ref'])
        if refreshed is not None:
            signal['refresh'] = refreshed['status']
            if refreshed['status'] == 'failed':
                signal['note'] = f'刷新失败：{refreshed.get("error")}'
                if signal['status'] in ('quiet', 'recorded'):
                    signal['status'] = 'stale'
        if signal.get('status') != 'missing-source' and signal.get('asset') and signal.get('version'):
            inputs.append({'asset': signal['asset'], 'version': signal['version'],
                           'kind': signal.get('assetKind') or signal['kind']})
        signals.append(signal)
    seen = set()
    unique_inputs = []
    for entry in inputs:
        key = (entry['asset'], entry['version'])
        if key in seen:
            continue
        seen.add(key)
        unique_inputs.append(entry)
    summary = {
        'moves': sum(1 for s in signals if s['status'] == 'move'),
        'quiet': sum(1 for s in signals if s['status'] == 'quiet'),
        'stale': sum(1 for s in signals if s['status'] == 'stale'),
        'missing': sum(1 for s in signals if s['status'] == 'missing-source'),
        'due': sum(1 for s in signals if s['status'] == 'due'),
        'recorded': sum(1 for s in signals if s['status'] == 'recorded'),
    }
    return {'signals': signals, 'refresh': refresh, 'inputs': unique_inputs, 'summary': summary}


def _append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + '\n')


def run(path: str | Path,
        run_id: str | None = None,
        trigger: dict | None = None,
        record_dir: str | Path | None = None,
        move_pct: float = _DEFAULT_MOVE_PCT,
        volume_ratio: float = _DEFAULT_VOLUME_RATIO,
        freshness_max_age_days: int = _DEFAULT_FRESHNESS_MAX_AGE_DAYS) -> dict:
    """校验并计算信号，把一行 ``step: signal`` 记录追加到运行目录。

    :param run_id: 本次运行 id；省略时按本地时间生成，便于手动运行。
    :param trigger: 触发来源 ``{kind, ...}``；省略记 ``manual``。
    :param record_dir: 运行记录目录；省略用 ``<家目录>/desk/runs``。
    :returns: 写入的那一行。
    :raises ValueError: 定义非法。
    """
    spec = validate(path)
    computed = _signals(spec, move_pct, volume_ratio, freshness_max_age_days)
    record = {
        'ts': _local_iso(),
        'runId': run_id or f"manual-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        'task': spec['name'],
        'step': 'signal',
        'status': 'partial' if computed['summary']['missing'] or computed['summary']['stale'] else 'ok',
        'trigger': trigger or {'kind': 'manual'},
        'signals': computed['signals'],
        'refresh': computed['refresh'],
        'inputs': computed['inputs'],
        'summary': computed['summary'],
        'thresholds': {
            'movePct': move_pct,
            'volumeRatio': volume_ratio,
            'freshnessMaxAgeDays': freshness_max_age_days,
        },
    }
    destination = Path(record_dir) if record_dir else runs_dir()
    _append_jsonl(destination / f'{spec["name"]}.jsonl', record)
    return record


def find_signal_record(task: str, run_id: str, record_dir: str | Path | None = None) -> dict:
    """在运行记录里找指定 runId 的 signal 行。

    :raises ValueError: 记录文件不存在或没有该 runId 的 signal 行。
    """
    destination = Path(record_dir) if record_dir else runs_dir()
    path = destination / f'{task}.jsonl'
    if not path.is_file():
        raise ValueError(f'运行记录不存在: {path}')
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if record.get('runId') == run_id and record.get('step') == 'signal':
            return record
    raise ValueError(f'运行 {run_id} 没有 signal 记录: {path}')


def _require_text(value, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{where} 必须是非空字符串')
    if len(value) > _REPORT_SECTION_MAX_CHARS:
        raise ValueError(f'{where} 超过 {_REPORT_SECTION_MAX_CHARS} 字符上限')
    return value.strip()


def _require_points(value) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError('points 必须是非空列表（最多 5 条）')
    if len(value) > 5:
        raise ValueError(f'points 最多 5 条，当前 {len(value)} 条')
    points = []
    for index, item in enumerate(value):
        points.append(_require_text(item, f'points[{index}]'))
        if len(points[-1]) > _REPORT_POINT_MAX_CHARS:
            raise ValueError(f'points[{index}] 超过 {_REPORT_POINT_MAX_CHARS} 字符上限')
    return points


def _fallback_sections(record: dict, reason: str) -> dict:
    signals = record.get('signals') or []
    move_lines = []
    for signal in signals:
        if signal.get('status') != 'move':
            continue
        change = signal.get('change')
        change_text = '—' if change is None else f'{change * 100:+.2f}%'
        volume = signal.get('volumeRatio')
        volume_text = '' if volume is None else f'，量比 {volume:.2f}'
        move_lines.append(f"{signal['ref']} {change_text}{volume_text}")
    points = move_lines[:5]
    if not points:
        points = [f'本次运行没有可解读的异动信号（{reason}）']
    stale = [s['ref'] for s in signals if s.get('status') in ('stale', 'missing-source')]
    decisions = [{'kind': 'system',
                  'text': f'本次运行未产生 AI 解读（{reason}）。检查模型额度、网络与运行记录后重试。'}]
    if stale:
        decisions.append({'kind': 'data', 'text': f'以下关注对象缺少最新数据：{"、".join(stale)}'})
    return {
        'points': points,
        'moves': f'本次运行没有执行 AI 解读（{reason}）；以下仅为确定性信号，不含因果解释。',
        'theses': '本次运行没有执行命题复检。',
        'decisions': decisions,
    }


def _read_ai_sources(sources_file: str | Path | None) -> list[dict]:
    """读取 AI 阶段实际读取/执行的资产版本记录。

    文件由宿主工具在成功读取或执行后追加；缺失文件表示本次运行没有额外读取，
    而不是来源不完整。格式错误的行直接失败，避免报告带着不可信来源落盘。
    """
    if sources_file is None:
        return []
    path = Path(sources_file)
    if not path.is_file():
        return []
    out = []
    for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError as e:
            raise ValueError(f'AI 来源记录第 {number} 行不是 JSON: {e}') from e
        if not isinstance(row, dict):
            raise ValueError(f'AI 来源记录第 {number} 行不是对象')
        asset = row.get('asset')
        version = row.get('version')
        if not isinstance(asset, str) or not asset or not _positive_int(version):
            raise ValueError(f'AI 来源记录第 {number} 行缺少 asset 或正整数 version')
        out.append({
            'asset': asset,
            'version': version,
            'tool': row.get('tool') if isinstance(row.get('tool'), str) else None,
            'entry': row.get('entry') if isinstance(row.get('entry'), str) else None,
            'ts': row.get('ts') if isinstance(row.get('ts'), str) else None,
        })
    return out


def _merge_sources(record: dict, ai_sources: list[dict], sources_complete: bool) -> list[dict]:
    """把信号阶段与 AI 阶段的来源按 (asset, version) 合并；同一资产不同版本保持独立。"""
    merged: dict[tuple[str, int], dict] = {}
    order: list[tuple[str, int]] = []

    def add(asset: str, version: int, stage: str, kind=None, via=None) -> None:
        key = (asset, version)
        entry = merged.get(key)
        if entry is None:
            entry = {'asset': asset, 'version': version, 'stages': [stage]}
            if isinstance(kind, str) and kind:
                entry['kind'] = kind
            if isinstance(via, str) and via:
                entry['via'] = via
            merged[key] = entry
            order.append(key)
            return
        if stage not in entry['stages']:
            entry['stages'].append(stage)
        if 'kind' not in entry and isinstance(kind, str) and kind:
            entry['kind'] = kind

    for input_entry in record.get('inputs') or []:
        if isinstance(input_entry, dict) and isinstance(input_entry.get('asset'), str) \
                and _positive_int(input_entry.get('version')):
            add(input_entry['asset'], input_entry['version'], 'signal', input_entry.get('kind'))
    for source in ai_sources:
        via = source.get('entry') or source.get('tool')
        add(source['asset'], source['version'], 'ai', None, via)
    return [merged[key] for key in order]


def _source_label(entry: dict) -> str:
    stages = entry.get('stages') or []
    stage = '信号+AI' if 'signal' in stages and 'ai' in stages else ('AI 阶段' if 'ai' in stages else '信号阶段')
    via = entry.get('via')
    return f"`{entry['asset']}` @v{entry['version']}（{stage}{'' if via is None else f'，{via}'}）"


def _report_markdown(title: str, task: str, run_id: str, sections: dict, record: dict,
                     fallback: bool, sources: list[dict]) -> str:
    lines = [
        f'# {title}',
        '',
        f'- 值班任务：`{task}`',
        f'- 运行 id：`{run_id}`',
        f'- 生成时间：{_local_iso()}',
        f'- 触发来源：`{(record.get("trigger") or {}).get("kind", "manual")}`',
        f'- 版本：{"无解读版（确定性信号）" if fallback else "AI 解读版"}',
        '',
        '## 要点',
        '',
        *[f'{index}. {point}' for index, point in enumerate(sections['points'], 1)],
        '',
        '## 异动解读',
        '',
        sections['moves'],
        '',
        '## 命题复检',
        '',
        sections['theses'],
        '',
        '## 待你决策',
        '',
    ]
    if sections['decisions']:
        lines.extend(f'- [{item.get("kind", "note")}] {item.get("text", "")}'
                     for item in sections['decisions'])
    else:
        lines.append('（无）')
    lines += ['', '## 来源版本', '']
    if sources:
        lines.extend(f'- {_source_label(entry)}' for entry in sources)
    else:
        lines.append('（本次运行没有读取到资产版本）')
    return '\n'.join(lines).rstrip('\n') + '\n'


def archive_report(task: str,
                   run_id: str,
                   payload: dict,
                   record_dir: str | Path | None = None,
                   asset_dir: str | Path | None = None,
                   sources_file: str | Path | None = None,
                   write_record: bool = True) -> dict:
    """把一份报告归档为资产版本，并把关联行追加到运行记录。

    payload 字段：``title``、``points``、``moves``、``theses``、``decisions``（可选）、
    ``sessionId``（可选）、``fallback``（可选）、``fallbackReason``（可选）。
    来源版本来自本次运行的 signal 记录和 ``sources_file`` 中 AI 阶段实际读取的
    资产版本；调用方不能自报。``sources_file`` 省略时标记来源不完整。

    :returns: ``{asset, version, dir, tags, fallback, sources, sourcesComplete}``。
    :raises ValueError: 运行记录或报告字段非法，或资产库拒绝该版本。
    """
    if not isinstance(payload, dict):
        raise ValueError('报告 payload 必须是对象')
    if asset_dir is not None:
        os.environ['FINDECK_ASSET_DIR'] = str(asset_dir)
    record = find_signal_record(task, run_id, record_dir)
    ai_sources = _read_ai_sources(sources_file)
    sources_complete = sources_file is not None
    sources = _merge_sources(record, ai_sources, sources_complete)
    fallback = payload.get('fallback') is True
    reason = str(payload.get('fallbackReason') or '运行未完成').strip()
    if fallback:
        sections = _fallback_sections(record, reason)
    else:
        sections = {
            'points': _require_points(payload.get('points')),
            'moves': _require_text(payload.get('moves'), 'moves'),
            'theses': _require_text(payload.get('theses'), 'theses'),
        }
        decisions = payload.get('decisions') or []
        if not isinstance(decisions, list):
            raise ValueError('decisions 必须是列表')
        parsed = []
        for index, item in enumerate(decisions):
            if not isinstance(item, dict):
                raise ValueError(f'decisions[{index}] 必须是对象')
            kind = item.get('kind') or 'note'
            if not isinstance(kind, str) or not _KEBAB_RE.match(kind):
                raise ValueError(f'decisions[{index}].kind 必须是 kebab-case: {kind!r}')
            parsed.append({'kind': kind, 'text': _require_text(item.get('text'), f'decisions[{index}].text')})
        sections['decisions'] = parsed
    title = str(payload.get('title') or f'{task} 值班报告').strip()
    if not title:
        raise ValueError('报告标题不能为空')
    source_session = payload.get('sessionId')
    if not isinstance(source_session, str) or not source_session.strip():
        source_session = f'desk-{run_id}'
    report_name = f'{task}-report'
    existing = next((entry for entry in assets.list_all() if entry['name'] == report_name), None)
    latest = existing['latest_version'] if existing else None
    version = (latest + 1) if latest else 1
    supersedes = f'{report_name}@v{latest}' if latest else None
    unique_deps = []
    for entry in sources:
        name = entry['asset']
        if name not in unique_deps:
            unique_deps.append(name)
    tags = ['desk', task] + (['no-interpretation'] if fallback else [])
    markdown = _report_markdown(title, task, run_id, sections, record, fallback, sources)
    face = {
        'version': 1,
        'title': title,
        'blocks': [
            {'type': 'metric-card', 'title': '要点数', 'verb': 'preview', 'extract': 'version',
             'format': 'int'},
            {'type': 'log-view', 'title': '报告正文', 'verb': 'preview'},
        ],
    }
    structured = {
        'task': task,
        'runId': run_id,
        'title': title,
        'fallback': fallback,
        'fallbackReason': None if not fallback else reason,
        'sections': sections,
        'sources': sources,
        'sourcesComplete': sources_complete,
        'trigger': record.get('trigger'),
    }
    # The confined Windows temp grant does not accept a nested scratch directory.
    # The asset library is the writable root, so the scratch lives there and is
    # removed after the version directory has its own copy.
    scratch_root = assets.asset_root() / '.desk-report-scratch'
    scratch_root.mkdir(parents=True, exist_ok=True)
    scratch = scratch_root / f'{task}-{run_id}'
    if scratch.exists():
        shutil.rmtree(scratch)
    scratch.mkdir()
    try:
        (scratch / 'report.md').write_text(markdown, encoding='utf-8')
        (scratch / 'report.json').write_text(
            json.dumps(structured, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        (scratch / 'face.json').write_text(
            json.dumps(face, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        manifest = {
            'name': report_name,
            'kind': 'report',
            'version': version,
            'created': date.today().isoformat(),
            'source_session': source_session,
            'description': sections['points'][0],
            'interface': '四段式 markdown 报告（要点/异动解读/命题复检/待你决策）与 face.json',
            'dependencies': [],
            'depends_on': list(unique_deps),
            'supersedes': supersedes,
            'validation': f'值班运行 {run_id} 自动生成；数字来源见报告的来源版本一节，不构成投资建议',
            'origin': 'agent',
            'verbs': ['preview'],
            'tags': tags,
            'face': 'face.json',
            'lineage': {
                'producer': {
                    'script': 'findeck.desk',
                    'params': {'runId': run_id, 'fallback': fallback},
                    'session': source_session,
                },
                'inputs': list(unique_deps),
            },
        }
        target = assets.archive(scratch, manifest)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    line = {
        'ts': _local_iso(),
        'runId': run_id,
        'task': task,
        'step': 'report',
        'status': 'ok',
        'report': {
            'asset': report_name,
            'version': version,
            'dir': target,
            'tags': tags,
            'fallback': fallback,
        },
        'sources': sources,
        'sourcesComplete': sources_complete,
    }
    if write_record:
        destination = Path(record_dir) if record_dir else runs_dir()
        _append_jsonl(destination / f'{task}.jsonl', line)
    result = {'asset': report_name, 'version': version, 'dir': target, 'tags': tags,
              'fallback': fallback, 'sources': sources, 'sourcesComplete': sources_complete}
    if not write_record:
        result['line'] = line
    return result


def list_tasks() -> list[dict]:
    """列出 ``<家目录>/desk/tasks/*.yaml`` 的摘要（逐个校验）。

    :raises ValueError: 其中一份校验失败。
    """
    base = tasks_dir()
    if not base.is_dir():
        return []
    out = []
    for path in sorted(base.glob('*.yaml')):
        spec = validate(path)
        out.append({
            'name': spec['name'],
            'display_name': spec['display_name'],
            'enabled': spec.get('enabled', True),
            'report': spec['report'],
            'targets': len(spec['targets']),
            'path': str(path),
        })
    return out


def main(argv: list[str] | None = None) -> int:
    """CLI：校验、算信号、归档报告、列出任务。"""
    parser = argparse.ArgumentParser(
        prog='python -m findeck.desk',
        description='FinDeck 值班任务：tasks/<name>.yaml 的校验、信号计算与报告归档')
    sub = parser.add_subparsers(dest='command', required=True)
    validate_parser = sub.add_parser('validate', help='校验一份值班任务 yaml（fail loud）')
    validate_parser.add_argument('path', help='任务 yaml 路径，如 ~/.findeck/desk/tasks/morning-watch.yaml')
    run_parser = sub.add_parser('run', help='计算信号并追加一行运行记录')
    run_parser.add_argument('path', help='任务 yaml 路径')
    run_parser.add_argument('--run-id', default=None, help='本次运行 id（省略时按本地时间生成）')
    run_parser.add_argument('--trigger-json', default=None, help='触发来源 JSON，如 {"kind":"cron"}')
    run_parser.add_argument('--runs-dir', default=None, help='运行记录目录（省略用家目录默认值）')
    run_parser.add_argument('--move-pct', type=float, default=_DEFAULT_MOVE_PCT,
                            help=f'涨跌幅异动阈值（默认 {_DEFAULT_MOVE_PCT}）')
    run_parser.add_argument('--volume-ratio', type=float, default=_DEFAULT_VOLUME_RATIO,
                            help=f'成交量倍数阈值（默认 {_DEFAULT_VOLUME_RATIO}）')
    run_parser.add_argument('--freshness-max-age-days', type=int, default=_DEFAULT_FRESHNESS_MAX_AGE_DAYS,
                            help=f'资产新鲜度上限（天，默认 {_DEFAULT_FRESHNESS_MAX_AGE_DAYS}）')
    archive_parser = sub.add_parser('archive-report', help='归档四段式报告（或 --payload 的 fallback=true 无解读版）')
    archive_parser.add_argument('--task', required=True, help='任务名')
    archive_parser.add_argument('--run-id', required=True, help='本次运行 id')
    archive_parser.add_argument('--runs-dir', default=None, help='运行记录目录（省略用家目录默认值）')
    archive_parser.add_argument('--asset-dir', default=None, help='资产库根目录（省略用 FINDECK_ASSET_DIR 或家目录默认值）')
    archive_parser.add_argument('--payload', required=True, help='报告 payload JSON 文件路径')
    archive_parser.add_argument('--sources-file', default=None,
                                help='AI 阶段实际读取的资产版本书面记录（省略表示来源不完整）')
    archive_parser.add_argument('--no-record', action='store_true',
                                help='不写运行记录，把该行放入结果的 line 字段（沙箱内归档用）')
    sub.add_parser('list', help=f'列出 {tasks_dir()} 下全部任务')
    args = parser.parse_args(argv)
    try:
        if args.command == 'validate':
            spec = validate(args.path)
            print(f'[desk] 校验通过: {spec["name"]}（{spec["display_name"]}，'
                  f'{len(spec["targets"])} 个关注对象，report={spec["report"]}）')
        elif args.command == 'run':
            trigger = json.loads(args.trigger_json) if args.trigger_json else None
            if trigger is not None and not isinstance(trigger, dict):
                raise ValueError('--trigger-json 必须是对象')
            record = run(args.path, run_id=args.run_id, trigger=trigger,
                         record_dir=args.runs_dir, move_pct=args.move_pct,
                         volume_ratio=args.volume_ratio,
                         freshness_max_age_days=args.freshness_max_age_days)
            print(json.dumps(record, ensure_ascii=False))
        elif args.command == 'archive-report':
            payload = json.loads(Path(args.payload).read_text(encoding='utf-8'))
            result = archive_report(args.task, args.run_id, payload,
                                    record_dir=args.runs_dir, asset_dir=args.asset_dir,
                                    sources_file=args.sources_file,
                                    write_record=not args.no_record)
            print(json.dumps(result, ensure_ascii=False))
        else:
            items = list_tasks()
            if not items:
                print(f'[desk] {tasks_dir()} 下暂无值班任务')
            for item in items:
                print(f'{item["name"]}\t{item["display_name"]}\t{item["targets"]} 个关注对象\t'
                      f'report={item["report"]}\tenabled={item["enabled"]}')
    except (ValueError, RuntimeError, KeyError, OSError, json.JSONDecodeError) as e:
        print(f'[desk] 失败:\n{e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
