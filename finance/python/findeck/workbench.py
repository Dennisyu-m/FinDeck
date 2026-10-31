"""资产 Work 模式：``workbench.yaml`` 定义格式的校验器与 brief 生成器。

位置约定：随产品交付的定义在 ``finance/workbenches/<name>.yaml``；用户从资产页创建的
定义在 ``<家目录>/workbenches/<name>.yaml``（``FINDECK_WORKBENCH_DIR`` 可整体改掉该目录）。
两份目录同名时用户定义优先。``name`` 与文件名一致。一份 workbench 定义"围绕哪一组已有
资产干活"——资产集合（引用资产库中的资产名）+ 运行约定（常用 verb 序列、参数边界、解读
要求）+ 展示名/描述。它自己不是执行器：真正跑起来的是资产声明的 verbs（``verb_bridge``）
或流水线（``pipeline``），workbench 只提供会话锚与运行约定。

定义格式（速查见 ``finance/skills/findeck-workbench/SKILL.md``）::

    name: hs300-research            # kebab-case，必须与文件名一致
    display_name: 沪深300研究台      # 必填非空，UI 展示名
    description: 围绕沪深300资产的日常研究台
    assets:                         # 必填非空；每个名字必须存在于资产库（index.json）
      - hs300-constituents
      - hs300-monthly-panel
    conventions:                    # 可选对象；给了就必须是对象
      verbs: [update, predict]      # 可选，常用 verb 序列（kebab-case，建议序非硬编排）
      notes: |                      # 可选，自由文本：参数边界、解读要求等运行约定
        每次会话结束产出解读 report 资产

校验规则（全部 fail loud，未知键一律拒绝）：顶层键恰好
``{name, display_name, description, assets, conventions}``；``conventions`` 键 ⊆
``{verbs, notes}``；``name`` kebab-case 且与文件名一致；``display_name`` / ``description``
非空；``assets`` 非空列表、元素唯一且都在资产库 index.json 中存在；``conventions.verbs``
元素 kebab-case；``conventions.notes`` 为非空字符串。

:func:`brief` 把一份定义展开成给 AI 开会话用的 markdown 锚：每个资产的【名字、最新版本号、
版本目录绝对路径、kind、verbs、as_of、描述】加 conventions 全文——路径都是真的，AI 拿它
就能直接操作资产。

CLI::

    python -m findeck.workbench validate finance/workbenches/hs300-research.yaml
    python -m findeck.workbench list
    python -m findeck.workbench show hs300-research
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import yaml

from . import assets

__all__ = ['load', 'validate', 'brief', 'list_workbenches', 'list_workbenches_with_problems', 'user_workbench_dir']

WORKBENCH_DIR = 'finance/workbenches'
_KEBAB_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
_TOP_KEYS = {'name', 'display_name', 'description', 'assets', 'conventions'}
_CONVENTION_KEYS = {'verbs', 'notes'}


def repo_root() -> Path:
    """仓库根目录（workbench 定义默认从 ``finance/workbenches/`` 下解析）。"""
    return Path(__file__).resolve().parents[3]


def _harness_home() -> Path:
    """Harness 家目录，与 ``findeck.desk.harness_home`` 同一套优先级。"""
    for key in ('FINDECK_HOME', 'ALPHADECK_HOME', 'DSH_HOME'):
        value = os.environ.get(key)
        if not value:
            continue
        path = Path(value).expanduser()
        if key == 'DSH_HOME' and path.name == '.dsh':
            continue
        return path
    return Path.home() / '.findeck'


def user_workbench_dir() -> Path:
    """用户 workbench 目录：``FINDECK_WORKBENCH_DIR``，否则 ``<家目录>/workbenches``。"""
    override = os.environ.get('FINDECK_WORKBENCH_DIR')
    return Path(override).expanduser() if override else _harness_home() / 'workbenches'


def load(path: str | Path) -> dict:
    """读入 workbench.yaml 并返回顶层映射。

    :raises ValueError: 文件不存在、YAML 解析失败或顶层不是映射。
    """
    p = Path(path)
    if not p.is_file():
        raise ValueError(f'workbench 文件不存在: {p}')
    try:
        raw = yaml.safe_load(p.read_text(encoding='utf-8'))
    except yaml.YAMLError as e:
        raise ValueError(f'workbench YAML 解析失败: {p}: {e}') from e
    if not isinstance(raw, dict):
        raise ValueError(f'workbench 顶层必须是映射（key: value）: {p}')
    return raw


def _resolve(name: str | Path) -> Path:
    """把 workbench 名解析成定义文件路径（用户目录优先，其次随产品交付的目录）。"""
    p = Path(name)
    if p.suffix in ('.yaml', '.yml') or p.is_file():
        return p
    user = user_workbench_dir() / f'{name}.yaml'
    if user.is_file():
        return user
    return repo_root() / WORKBENCH_DIR / f'{name}.yaml'


def _known_assets() -> list[str]:
    """资产库现有资产名（读 ``index.json``；索引缺失时退回直接扫库内 manifest）。"""
    index = assets.asset_root() / 'index.json'
    if index.is_file():
        data = json.loads(index.read_text(encoding='utf-8'))
        return sorted(a['name'] for a in data.get('assets', []))
    return sorted(a['name'] for a in assets.list_all())


def _check_conventions(conv, errors: list[str]) -> None:
    if not isinstance(conv, dict):
        errors.append(f'conventions 必须是对象: {conv!r}')
        return
    unknown = sorted(set(conv) - _CONVENTION_KEYS)
    if unknown:
        errors.append(f'conventions 出现未知字段 {unknown}（允许: {sorted(_CONVENTION_KEYS)}）')
    verbs = conv.get('verbs')
    if verbs is not None and (not isinstance(verbs, list) or not verbs
                              or any(not isinstance(v, str) or not _KEBAB_RE.match(v) for v in verbs)):
        errors.append(f'conventions.verbs 必须是非空 kebab-case 字符串列表: {verbs!r}')
    notes = conv.get('notes')
    if notes is not None and (not isinstance(notes, str) or not notes.strip()):
        errors.append(f'conventions.notes 必须是非空字符串: {notes!r}')


def _check_assets(names, errors: list[str]) -> None:
    if not isinstance(names, list) or not names:
        errors.append(f'assets 必须是非空列表（资产库中的资产名）: {names!r}')
        return
    bad = [n for n in names if not isinstance(n, str) or not _KEBAB_RE.match(n)]
    if bad:
        errors.append(f'assets 元素必须是 kebab-case 资产名: {bad!r}')
        return
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        errors.append(f'assets 元素必须唯一，重复: {dupes}')
    available = _known_assets()
    missing = [n for n in names if n not in available]
    if missing:
        errors.append(f'assets 引用了资产库中不存在的资产 {missing}；库中现有: {available}')


def validate(path: str | Path) -> dict:
    """校验一份 workbench.yaml，通过则返回它，失败则把所有错误一次性汇总抛出。

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
    for k in ('display_name', 'description'):
        if not isinstance(spec.get(k), str) or not spec[k].strip():
            errors.append(f'{k} 必填且为非空字符串: {spec.get(k)!r}')
    _check_assets(spec.get('assets'), errors)
    if 'conventions' in spec:
        _check_conventions(spec['conventions'], errors)
    if errors:
        listed = '\n'.join(f'  - {e}' for e in errors)
        raise ValueError(f'workbench 定义非法（{p}）:\n{listed}')
    return spec


class _Dumper(yaml.SafeDumper):
    """brief 里回显 conventions 用的转储器：多行字符串按 ``|`` 块标量写，保持可读。"""


_Dumper.add_representer(str, lambda d, s: d.represent_scalar(
    'tag:yaml.org,2002:str', s, style='|' if '\n' in s else None))


def _csv(values) -> str:
    return '、'.join(str(v) for v in values) if values else '（无）'


def brief(name: str | Path) -> str:
    """把一份 workbench 定义展开成给 AI 做会话锚的 markdown brief。

    每个资产给出来源信息（最新版本号、版本目录绝对路径、kind、verbs、as_of、描述），
    末尾附 conventions 全文；所有路径都是资产库中的真实目录。

    :param name: workbench 名（如 ``hs300-research``），或直接给定义文件路径。
    :raises ValueError: 定义不存在或校验失败。
    """
    spec = validate(_resolve(name))
    entries = {a['name']: a for a in assets.list_all()}
    lines = [
        f'# Work 模式：{spec["display_name"]}（{spec["name"]}）',
        '',
        spec['description'],
        '',
        f'资产库根目录：{assets.asset_root()}',
        '',
        '你是这个 Work 模式的操作员 + 评论员：优先运行下列资产作答'
        '（verb 桥 `python -m findeck.verb_bridge`，或流水线 `python -m findeck.pipeline run`），'
        '不要从零重做；修改资产前先说明意图，修改后汇报改了什么/为什么/前后对比。',
        '',
        f'## 资产（{len(spec["assets"])} 个）',
        '',
    ]
    for i, an in enumerate(spec['assets'], 1):
        a = entries[an]
        lines += [
            f'### {i}. {an}',
            f'- 最新版本：v{a["latest_version"]}',
            f'- 版本目录：{assets.find(an)}',
            f'- kind：{a["kind"]}',
            f'- verbs：{_csv(a["verbs"])}',
        ]
        freshness = a.get('freshness') or {}
        if freshness.get('as_of'):
            freq = freshness.get('update_frequency')
            lines.append(f'- as_of：{freshness["as_of"]}' + (f'（更新频率 {freq}）' if freq else ''))
        lines.append(f'- 描述：{a["description"]}')
        # 消费自身上一版做增量是合法写法（R7），但"自己是自己的上游"写进 brief 只会误导
        upstream = [d for d in (a.get('depends_on') or []) if d != an]
        if upstream:
            lines.append(f'- 上游资产：{_csv(upstream)}')
        lines.append('')
    conv = spec.get('conventions')
    lines += ['## 运行约定', '']
    if not conv:
        lines += ['（未声明）']
    else:
        lines += ['### 常用 verb 序列', '', _csv(conv.get('verbs')) if conv.get('verbs') else '（未声明）', '']
        lines += ['### 备注', '', conv['notes'].strip() if conv.get('notes') else '（未声明）', '']
        lines += ['### 约定原文（YAML）', '', '```yaml',
                  yaml.dump(conv, Dumper=_Dumper, sort_keys=False, allow_unicode=True).strip(), '```']
    return '\n'.join(lines).rstrip('\n') + '\n'


def list_workbenches(strict: bool = True) -> list[dict]:
    """列出随产品交付与用户目录中的全部 workbench 摘要（用户同名覆盖）。

    严格模式下任一文件校验失败即抛错；非严格模式跳过该文件，把失败原因放进
    :func:`list_workbenches_with_problems` 的问题列表，供资产页在库不完整时
    仍能看到可用定义。
    """
    items, problems = list_workbenches_with_problems()
    if strict and problems:
        raise ValueError('\n'.join(problems))
    return items


def list_workbenches_with_problems() -> tuple[list[dict], list[str]]:
    """列出全部可用 workbench，并返回无法读取/校验的定义问题（不中断列表）。"""
    out: list[dict] = []
    problems: list[str] = []
    seen: set[str] = set()
    for base in (user_workbench_dir(), repo_root() / WORKBENCH_DIR):
        if not base.is_dir():
            continue
        for p in sorted(base.glob('*.yaml')):
            try:
                spec = validate(p)
            except (ValueError, KeyError) as e:
                problems.append(f'{p}: {e}')
                continue
            if spec['name'] in seen:
                continue
            seen.add(spec['name'])
            out.append({'name': spec['name'], 'display_name': spec['display_name'],
                        'description': spec['description'], 'assets': list(spec['assets']),
                        'has_conventions': 'conventions' in spec, 'path': str(p),
                        'user_defined': base == user_workbench_dir()})
    return sorted(out, key=lambda item: item['name']), problems


def main(argv: list[str] | None = None) -> int:
    """CLI：``validate <path>`` 校验；``list`` 列全部；``show <name>`` 打印 brief。"""
    parser = argparse.ArgumentParser(
        prog='python -m findeck.workbench',
        description='FinDeck Work 模式：workbench.yaml 的校验器与 brief 生成器')
    sub = parser.add_subparsers(dest='command', required=True)
    pv = sub.add_parser('validate', help='校验 workbench.yaml（fail loud）')
    pv.add_argument('path', help=f'workbench.yaml 路径，如 {WORKBENCH_DIR}/hs300-research.yaml')
    list_parser = sub.add_parser('list', help=f'列出 {WORKBENCH_DIR}/ 与用户目录下全部 workbench')
    list_parser.add_argument('--json', action='store_true', help='输出机器可读 JSON（宿主 Remote 使用）')
    ps = sub.add_parser('show', help='打印某个 workbench 的 brief（给 AI 的会话锚）')
    ps.add_argument('name', help='workbench 名，如 hs300-research')
    args = parser.parse_args(argv)
    try:
        if args.command == 'validate':
            spec = validate(args.path)
            print(f'[workbench] 校验通过: {spec["name"]}（{len(spec["assets"])} 个资产，'
                  f'{spec["display_name"]}）')
        elif args.command == 'list':
            items, problems = list_workbenches_with_problems()
            if args.json:
                print(json.dumps({'items': items, 'problems': problems}, ensure_ascii=False))
                return 0
            if not items:
                print(f'[workbench] {WORKBENCH_DIR}/ 下暂无 workbench 定义')
            for it in items:
                print(f'{it["name"]}\t{it["display_name"]}\t{len(it["assets"])} 个资产\t{it["description"]}')
            for problem in problems:
                print(f'[workbench] 跳过不可用定义: {problem}', file=sys.stderr)
        else:
            print(brief(args.name), end='')
    except (ValueError, RuntimeError, KeyError) as e:
        print(f'[workbench] 失败:\n{e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
