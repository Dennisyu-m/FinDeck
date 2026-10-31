"""FinDeck 内置量化工具箱：开箱即用的模型接口、图表与资产库。

AI 可直接 `from findeck import quickmodels, charts, snapshot, assets`，也可按 skill 手册
用原生库自己写。模型工厂只封装**已预装**的库（sklearn/lightgbm/statsmodels）；
PyTorch 系仍按需安装（见 findeck-quant-models skill）。
snapshot 是数据快照纪律的统一入口（拉数走它，报告数字可复现）；
assets 是全局资产工作区（模型/权重/代码跨会话沉淀与复用）；
pipeline 是资产流水线的定义与执行入口（pipeline.yaml 校验 + 逐步执行 + 自动归档新版本资产）；
verb_bridge 是 face/verb 执行桥入口（资产页面或脚本发起的 verb 调用 → 库内资产执行 → 结构化结果回流）；
background 是后台 run 机制（`--background` 立刻返回 run_id、结果落 `<asset_root>/runs/<run_id>.json`，
由 verb_bridge / pipeline 的 CLI 共用；没有自己的 CLI 入口，故不在 _LAZY 里）；
workbench 是 Work 模式定义的校验器与 brief 生成器（workbench.yaml → 给 AI 的会话锚）；
desk 是值班任务定义的校验器（``~/.findeck/desk/tasks/<name>.yaml``）。
"""

from . import assets, charts, quickmodels, snapshot

__all__ = ['assets', 'charts', 'desk', 'pipeline', 'quickmodels', 'snapshot', 'verb_bridge', 'workbench']

_LAZY = ('desk', 'pipeline', 'verb_bridge', 'workbench')


def __getattr__(name: str):
    """惰性暴露有 CLI 入口的子模块（desk / pipeline / verb_bridge / workbench）。

    它们都能 `python -m findeck.<name>` 执行；若在本文件里 eager import，runpy 会因该子模块
    已在 sys.modules 中而重复执行并打 RuntimeWarning。惰性 import 让
    ``from findeck import desk, pipeline, verb_bridge, workbench`` 照常可用，同时保持 CLI 输出干净。
    """
    if name in _LAZY:
        import importlib

        return importlib.import_module(f'.{name}', __name__)
    raise AttributeError(f'module {__name__!r} has no attribute {name!r}')
