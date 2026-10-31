"""资产流水线：``pipeline.yaml`` 定义格式的校验器与执行器。

位置约定：``finance/pipelines/<name>.yaml``（``name`` 与文件名一致），步骤脚本放在
``finance/pipelines/<name>/`` 下。一条流水线把"消费上游资产 → 跑脚本 → 归档新版本资产"
串起来，血缘由执行器自动累积（``depends_on`` / ``lineage``），不需要脚本自己写 manifest。

定义格式（速查见 ``finance/skills/findeck-pipeline/SKILL.md``）::

    name: daily-refresh
    description: 一句话
    trigger: { kind: cron, schedule: "0 17 * * 1-5" }   # 或 { kind: manual }，或 { kind: interval, everySeconds: 3600 }
    steps:
      - id: update-panel
        script: finance/pipelines/daily-refresh/update_panel.py
        params: { window_years: 8 }        # 可选，经 FINDECK_STEP_PARAMS（JSON）传给脚本
        inputs: [hs300-constituents]       # 可选，消费的上游资产名 → depends_on/lineage.inputs
        produces:                          # 可选；声明则步骤成功后自动归档新版本
          name: hs300-monthly-panel
          kind: dataset
          verbs: [preview, update]
          description: 沪深300成分股月度面板
          interface: pd.read_parquet(...) -> DataFrame[...]
          out: output/hs300_monthly_panel.parquet   # 脚本落盘产物（仓库相对路径）
          tags: [hs300, monthly]           # 可选，meta 未给 tags 时用
          dependencies: [pandas, pyarrow]  # 可选，manifest 的 Python 依赖
          update_frequency: monthly        # 可选，仅 dataset，写进 freshness

脚本协议：脚本自行把产物写到 ``produces.out``；stdout **最后一行**必须是
``###FINDECK_STEP_META### {"validation": "实测指标", "as_of": "YYYY-MM-DD", "tags": [...]}``
（``as_of`` 仅 kind=dataset 必填，``tags`` 可选）。marker 缺失或 JSON 非法 → 该步判失败；
``validation`` 必须来自实跑，禁止静态填写。脚本还会收到 ``FINDECK_PIPELINE`` /
``FINDECK_STEP_ID`` / ``FINDECK_STEP_OUT``（绝对路径，可为空）三个环境变量。

执行语义：步骤按 YAML 顺序执行；任一步退出码非 0 或 marker 缺失 → 中止整条流水线并报告失败步。
成功且声明 ``produces`` → 调 :func:`findeck.assets.archive` 归档：``version`` = 现有最大版 + 1、
``supersedes`` 自动填前一版、``origin='agent'``、``source_session`` 取环境变量 ``DSH_SESSION_ID``
（缺省 ``'pipeline'``）、``depends_on = inputs``、``lineage.producer = {script, params, session}``、
dataset 的 ``freshness.as_of`` 取 meta。

运行记录：每步一行 JSONL 追加到 ``<asset_root>/pipeline-runs/<pipeline>.jsonl``：
``{ts, pipeline, step, status, produced, inputs, duration_s}``。``inputs`` 是该步声明的上游资产名
（R8-3：消费上游也算"触碰"，供 P4 体检算活物率）；旧记录没有这个键，读者按 ``[]`` 处理。

CLI::

    python -m findeck.pipeline validate finance/pipelines/daily-refresh.yaml
    python -m findeck.pipeline run finance/pipelines/daily-refresh.yaml

后台执行（长流水线不占住调用方，机制见 :mod:`findeck.background`）::

    python -m findeck.pipeline run finance/pipelines/daily-refresh.yaml --background
    python -m findeck.pipeline --status <run_id>

``--background`` 立刻打印 ``{"run_id": ..., "status": "running"}``（exit 0），真正的执行在分离
子进程里跑；``--status <run_id>`` 打印 ``<asset_root>/runs/<run_id>.json``，退出码
ok→0 / error→1 / running→2 / 不存在→4。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

from . import assets, background

__all__ = ['load', 'validate', 'run']

STEP_META_MARKER = '###FINDECK_STEP_META###'
PIPELINE_DIR = 'finance/pipelines'
TRIGGER_KINDS = ('manual', 'cron', 'interval')
_KEBAB_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
_ISO_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

_TOP_KEYS = {'name', 'description', 'trigger', 'steps'}
_TRIGGER_KEYS = {'kind', 'schedule', 'everySeconds'}
_STEP_KEYS = {'id', 'script', 'params', 'inputs', 'produces'}
_PRODUCES_KEYS = {'name', 'kind', 'verbs', 'description', 'interface', 'out',
                  'tags', 'dependencies', 'update_frequency'}


def repo_root() -> Path:
    """仓库根目录（pipeline.yaml 的 ``script`` / ``produces.out`` 都按它解析）。"""
    return Path(__file__).resolve().parents[3]


def load(path: str | Path) -> dict:
    """读入 pipeline.yaml 并返回顶层映射。

    :raises ValueError: 文件不存在、YAML 解析失败或顶层不是映射。
    """
    p = Path(path)
    if not p.is_file():
        raise ValueError(f'pipeline 文件不存在: {p}')
    try:
        raw = yaml.safe_load(p.read_text(encoding='utf-8'))
    except yaml.YAMLError as e:
        raise ValueError(f'pipeline YAML 解析失败: {p}: {e}') from e
    if not isinstance(raw, dict):
        raise ValueError(f'pipeline 顶层必须是映射（key: value）: {p}')
    return raw


def _check_trigger(trigger, errors: list[str]) -> None:
    if not isinstance(trigger, dict):
        errors.append('trigger 必填且必须是对象（如 {kind: manual}）')
        return
    unknown = sorted(set(trigger) - _TRIGGER_KEYS)
    if unknown:
        errors.append(f'trigger 出现未知字段 {unknown}（允许: {sorted(_TRIGGER_KEYS)}）')
    kind = trigger.get('kind')
    if kind not in TRIGGER_KINDS:
        errors.append(f'trigger.kind 必须是 {TRIGGER_KINDS} 之一: {kind!r}')
        return
    schedule = trigger.get('schedule')
    every = trigger.get('everySeconds')
    if kind == 'cron':
        if not isinstance(schedule, str) or not schedule.strip():
            errors.append(f'trigger.kind=cron 时 schedule 必填（cron 表达式）: {schedule!r}')
        if 'everySeconds' in trigger:
            errors.append('trigger.kind=cron 时不应声明 everySeconds')
    elif kind == 'interval':
        if isinstance(every, bool) or not isinstance(every, int) or every < 1:
            errors.append(
                f'trigger.kind=interval 时 everySeconds 必填且为正整数（秒）: {every!r}')
        if 'schedule' in trigger:
            errors.append('trigger.kind=interval 时不应声明 schedule')
    else:
        if 'schedule' in trigger:
            errors.append('trigger.kind=manual 时不应声明 schedule（该配置不会生效）')
        if 'everySeconds' in trigger:
            errors.append('trigger.kind=manual 时不应声明 everySeconds（该配置不会生效）')


def _check_produces(prod, where: str, errors: list[str]) -> None:
    if not isinstance(prod, dict):
        errors.append(f'{where}.produces 必须是对象: {prod!r}')
        return
    unknown = sorted(set(prod) - _PRODUCES_KEYS)
    if unknown:
        errors.append(f'{where}.produces 出现未知字段 {unknown}（允许: {sorted(_PRODUCES_KEYS)}）')
    name = prod.get('name')
    if not isinstance(name, str) or not _KEBAB_RE.match(name):
        errors.append(f'{where}.produces.name 必须是 kebab-case 资产名: {name!r}')
    kind = prod.get('kind')
    if kind not in assets.KINDS:
        errors.append(f'{where}.produces.kind 必须是 {assets.KINDS} 之一: {kind!r}')
    verbs = prod.get('verbs')
    if not isinstance(verbs, list) or not verbs or any(
            not isinstance(v, str) or not _KEBAB_RE.match(v) for v in verbs):
        errors.append(f'{where}.produces.verbs 必须是非空 kebab-case 字符串列表: {verbs!r}')
    for k in ('description', 'interface'):
        if not isinstance(prod.get(k), str) or not prod[k].strip():
            errors.append(f'{where}.produces.{k} 必填（写进 manifest）: {prod.get(k)!r}')
    out = prod.get('out')
    if not isinstance(out, str) or not out.strip():
        errors.append(f'{where}.produces.out 必填（脚本落盘产物的仓库相对路径）: {out!r}')
    else:
        op = Path(out)
        if op.is_absolute() or op.drive or op.root or any(part == '..' for part in op.parts):
            errors.append(f'{where}.produces.out 必须是仓库内相对路径（禁止绝对路径与 ..）: {out!r}')
    deps = prod.get('dependencies')
    if deps is not None and (not isinstance(deps, list) or any(not isinstance(d, str) for d in deps)):
        errors.append(f'{where}.produces.dependencies 必须是字符串列表: {deps!r}')
    tags = prod.get('tags')
    if tags is not None and (not isinstance(tags, list)
                             or any(not isinstance(t, str) or not _KEBAB_RE.match(t) for t in tags)):
        errors.append(f'{where}.produces.tags 必须是 kebab-case 字符串列表: {tags!r}')
    freq = prod.get('update_frequency')
    if freq is not None and (not isinstance(freq, str) or not freq.strip()):
        errors.append(f'{where}.produces.update_frequency 必须是非空字符串: {freq!r}')


def _check_steps(steps, errors: list[str]) -> None:
    if not isinstance(steps, list) or not steps:
        errors.append('steps 必须是非空列表')
        return
    seen: set[str] = set()
    root = repo_root()
    for i, step in enumerate(steps):
        where = f'steps[{i}]'
        if not isinstance(step, dict):
            errors.append(f'{where} 必须是映射: {step!r}')
            continue
        unknown = sorted(set(step) - _STEP_KEYS)
        if unknown:
            errors.append(f'{where} 出现未知字段 {unknown}（允许: {sorted(_STEP_KEYS)}）')
        sid = step.get('id')
        if not isinstance(sid, str) or not _KEBAB_RE.match(sid):
            errors.append(f'{where}.id 必须是 kebab-case 字符串: {sid!r}')
        else:
            where = f'步骤 {sid}'
            if sid in seen:
                errors.append(f'{where}: id 重复（步骤 id 必须流水线内唯一）')
            seen.add(sid)
        script = step.get('script')
        if not isinstance(script, str) or not script.strip():
            errors.append(f'{where}.script 必填且为字符串: {script!r}')
        else:
            sp = Path(script)
            abs_script = sp if sp.is_absolute() else root / sp
            if not abs_script.is_file():
                errors.append(f'{where}.script 文件不存在: {script}')
        params = step.get('params')
        if params is not None and not isinstance(params, dict):
            errors.append(f'{where}.params 必须是对象（经 FINDECK_STEP_PARAMS 传入脚本）: {params!r}')
        inputs = step.get('inputs')
        if inputs is not None and (not isinstance(inputs, list)
                                   or any(not isinstance(s, str) for s in inputs)):
            errors.append(f'{where}.inputs 必须是资产名字符串列表: {inputs!r}')
        prod = step.get('produces')
        if prod is not None:
            _check_produces(prod, where, errors)


def validate(path: str | Path) -> dict:
    """校验一份 pipeline.yaml，通过则返回它，失败则把所有错误一次性汇总抛出。

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
    description = spec.get('description')
    if not isinstance(description, str) or not description.strip():
        errors.append(f'description 必填且为非空字符串: {description!r}')
    _check_trigger(spec.get('trigger'), errors)
    _check_steps(spec.get('steps'), errors)
    if errors:
        listed = '\n'.join(f'  - {e}' for e in errors)
        raise ValueError(f'pipeline 定义非法（{p}）:\n{listed}')
    return spec


def _parse_marker(stdout: str, step_id: str, rc: int) -> dict:
    """从 stdout 最后一处 marker 解析步骤 meta（JSON）。"""
    idx = stdout.rfind(STEP_META_MARKER)
    if idx < 0:
        raise RuntimeError(
            f'步骤 {step_id} 失败（退出码 {rc}）：stdout 未出现 {STEP_META_MARKER}，'
            '无法确认这一步真的跑出了结果')
    tail = stdout[idx + len(STEP_META_MARKER):]
    payload = tail.splitlines()[0].strip() if tail.splitlines() else ''
    if not payload:
        raise RuntimeError(f'步骤 {step_id} 的 {STEP_META_MARKER} 后没有 JSON')
    try:
        meta = json.loads(payload)
    except json.JSONDecodeError as e:
        raise RuntimeError(f'步骤 {step_id} 的 {STEP_META_MARKER} 不是合法 JSON: {payload!r}') from e
    if not isinstance(meta, dict):
        raise RuntimeError(f'步骤 {step_id} 的 {STEP_META_MARKER} 必须是 JSON 对象: {meta!r}')
    return meta


def _next_version(name: str) -> tuple[int, int]:
    """返回 (新版本号, 当前最大版本号)；新版本 = 最大 + 1。"""
    latest = max((a['latest_version'] for a in assets.list_all() if a['name'] == name), default=0)
    return latest + 1, latest


def _execute_step(spec: dict, step: dict, root: Path) -> dict | None:
    """跑一个步骤：spawn 脚本 → 解析 marker → 归档 produces。返回 produced 记录（无 produces 时 None）。"""
    sid = step['id']
    params = step.get('params') or {}
    prod = step.get('produces')
    inputs = list(step.get('inputs') or [])
    env = os.environ.copy()
    env['FINDECK_STEP_PARAMS'] = json.dumps(params, ensure_ascii=False)
    env['FINDECK_PIPELINE'] = spec['name']
    env['FINDECK_STEP_ID'] = sid
    env['FINDECK_STEP_OUT'] = str((root / prod['out']).resolve()) if prod else ''
    env['PYTHONIOENCODING'] = 'utf-8'  # 子脚本中文输出统一按 UTF-8 解码
    script = root / step['script']
    # sys.executable 就是本进程的解释器，也就是资产库统一的 finance venv：
    # pipeline.py 本身只在该 venv 里可导入，因此这里直接用 sys.executable 即正确解释器。
    proc = subprocess.run([sys.executable, str(script)], cwd=root, env=env,
                          capture_output=True, text=True, encoding='utf-8', errors='replace')
    if proc.stdout:
        print(proc.stdout.rstrip('\n'))
    if proc.returncode != 0:
        print(proc.stderr.rstrip('\n'), file=sys.stderr)
        raise RuntimeError(f'步骤 {sid} 失败：{step["script"]} 退出码 {proc.returncode}')
    meta = _parse_marker(proc.stdout or '', sid, proc.returncode)
    if prod is None:
        return None
    validation = meta.get('validation')
    if not isinstance(validation, str) or not validation.strip():
        raise RuntimeError(f'步骤 {sid} 的 marker 缺少非空 validation（必须来自实跑）: {validation!r}')
    out_abs = (root / prod['out']).resolve()
    if not out_abs.exists():
        raise RuntimeError(f'步骤 {sid} 成功但声明的产物不存在: {out_abs}')
    session = os.environ.get('DSH_SESSION_ID') or 'pipeline'
    version, previous = _next_version(prod['name'])
    manifest = {
        'name': prod['name'],
        'kind': prod['kind'],
        'version': version,
        'created': date.today().isoformat(),
        'source_session': session,
        'description': prod['description'],
        'interface': prod['interface'],
        'dependencies': list(prod.get('dependencies') or []),
        # 两份列表用各自的对象，避免 yaml.safe_dump 写成锚点（&id001/*id001）
        'depends_on': list(inputs),
        'supersedes': f'{prod["name"]}@v{previous}' if previous else None,
        'validation': validation,
        'origin': 'agent',
        'verbs': list(prod['verbs']),
        'lineage': {'producer': {'script': step['script'], 'params': params, 'session': session},
                    'inputs': list(inputs)},
    }
    tags = meta.get('tags') or prod.get('tags') or []
    if tags:
        manifest['tags'] = list(tags)
    if prod['kind'] == 'dataset':
        as_of = meta.get('as_of')
        if not isinstance(as_of, str) or not _ISO_DATE_RE.match(as_of):
            raise RuntimeError(
                f'步骤 {sid} 产出 dataset，marker 必须带 as_of（YYYY-MM-DD）: {as_of!r}')
        manifest['freshness'] = {'as_of': as_of}
        if prod.get('update_frequency'):
            manifest['freshness']['update_frequency'] = prod['update_frequency']
    dest = assets.archive(out_abs, manifest)
    return {'asset': prod['name'], 'version': version, 'path': dest}


def _record(pipeline: str, step: str, status: str, produced: dict | None,
            inputs: list[str], started: float) -> dict:
    """一行运行记录；``inputs`` 是该步声明的上游资产名（消费上游也算触碰，R8-3）。"""
    return {
        'ts': datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds'),
        'pipeline': pipeline,
        'step': step,
        'status': status,
        'produced': produced,
        'inputs': list(inputs),
        'duration_s': round(time.time() - started, 2),
    }


def _append_run_record(pipeline: str, record: dict) -> None:
    """追加一行运行记录到 ``<asset_root>/pipeline-runs/<pipeline>.jsonl``。"""
    p = assets.asset_root() / 'pipeline-runs' / f'{pipeline}.jsonl'
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('a', encoding='utf-8') as f:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')


def run(path: str | Path) -> list[dict]:
    """执行一条流水线：按顺序跑每一步，任一步失败即中止。

    :returns: 每步一条运行记录（与 JSONL 里写的行一致）。
    :raises ValueError: pipeline.yaml 校验失败。
    :raises RuntimeError: 某步失败（退出码非 0 / marker 缺失 / 产物缺失 / 归档失败）。
    """
    spec = validate(path)
    root = repo_root()
    steps = spec['steps']
    records: list[dict] = []
    print(f'[pipeline] 开始执行 {spec["name"]}（{len(steps)} 步，cwd={root}）')
    for i, step in enumerate(steps, 1):
        started = time.time()
        inputs = list(step.get('inputs') or [])
        print(f'[pipeline] ({i}/{len(steps)}) 步骤 {step["id"]} -> {step["script"]}')
        try:
            produced = _execute_step(spec, step, root)
        except Exception:
            _append_run_record(spec['name'],
                               _record(spec['name'], step['id'], 'failed', None, inputs, started))
            raise
        record = _record(spec['name'], step['id'], 'ok', produced, inputs, started)
        _append_run_record(spec['name'], record)
        records.append(record)
        tail = f'（产出 {produced["asset"]}@v{produced["version"]}）' if produced else ''
        print(f'[pipeline] ({i}/{len(steps)}) 步骤 {step["id"]} 完成，用时 {record["duration_s"]}s{tail}')
    print(f'[pipeline] {spec["name"]} 全部 {len(steps)} 步完成')
    return records


def _finish_background_run(status: str, response: dict, error: str | None = None) -> None:
    """后台子进程收尾：把运行结果写回 run 记录（无 ``FINDECK_RUN_ID`` 时什么都不做）。

    写记录失败只告警不中断——子进程仍按原语义打印与返回退出码，run 记录停在 running
    （与"进程被杀"同一类已知限制，见 findeck.background）。
    """
    run_id = os.environ.get('FINDECK_RUN_ID')
    if not run_id:
        return
    try:
        background.finish(run_id, status=status, response=response, error=error)
    except Exception as e:  # 记录写不进去不能带走这次执行的结果
        print(f'[pipeline] 写 run 记录失败（记录将停在 running）: {type(e).__name__}: {e}',
              file=sys.stderr)


def _start_background(path: str) -> int:
    """``run <path> --background``：起分离子进程跑这条流水线，立刻打印 run_id。"""
    if not Path(path).is_file():
        print(json.dumps({'status': 'error', 'error': f'pipeline 文件不存在: {path}'},
                         ensure_ascii=False))
        return 1
    request = {'path': str(path), 'mode': 'run'}
    try:
        info = background.start('pipeline', request,
                                ['-m', 'findeck.pipeline', 'run', str(path)])
    except (ValueError, OSError) as e:
        print(json.dumps({'status': 'error', 'error': f'后台启动失败: {e}'}, ensure_ascii=False))
        return 1
    print(json.dumps(info, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI：``validate <path>`` 打印通过或逐条错误；``run <path> [--background]`` 执行流水线；
    ``--status <run_id>`` 查询后台 run（退出码见模块说明）。"""
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ['--status']:
        if len(argv) != 2:
            print('用法: python -m findeck.pipeline --status <run_id>', file=sys.stderr)
            return 1
        return background.status_cli(argv[1])
    parser = argparse.ArgumentParser(
        prog='python -m findeck.pipeline',
        description='FinDeck 资产流水线：pipeline.yaml 的校验器与执行器')
    sub = parser.add_subparsers(dest='command', required=True)
    for cmd, helptext in (('validate', '校验 pipeline.yaml（fail loud）'),
                          ('run', '按顺序执行流水线的全部步骤')):
        sp = sub.add_parser(cmd, help=helptext)
        sp.add_argument('path', help=f'pipeline.yaml 路径，如 {PIPELINE_DIR}/daily-refresh.yaml')
        if cmd == 'run':
            sp.add_argument('--background', action='store_true',
                            help='立刻返回 run_id，流水线在分离子进程里跑（用 --status 收结果）')
    args = parser.parse_args(argv)
    try:
        if args.command == 'validate':
            spec = validate(args.path)
            print(f'[pipeline] 校验通过: {spec["name"]}（{len(spec["steps"])} 步，'
                  f'trigger={spec["trigger"]["kind"]}）')
        elif args.background:
            return _start_background(args.path)
        else:
            records = run(args.path)
            _finish_background_run('ok', {'status': 'ok', 'pipeline': records[0]['pipeline'],
                                          'steps': records})
    except (ValueError, RuntimeError) as e:
        message = str(e)
        print(f'[pipeline] 失败:\n{message}', file=sys.stderr)
        _finish_background_run('error', {'status': 'error', 'pipeline': Path(args.path).stem,
                                         'error': message}, message)
        return 1
    except Exception as e:  # 后台子进程里未预料的异常也必须落终态，否则记录停在 running
        message = f'{type(e).__name__}: {e}'
        _finish_background_run('error', {'status': 'error', 'error': message}, message)
        raise
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
