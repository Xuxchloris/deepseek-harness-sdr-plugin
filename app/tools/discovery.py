"""阶段2 客户发现：从样例库捞候选客户（真实项目用 Apollo MCP / 搜索）。"""

from __future__ import annotations

from app.state import SDRTask
from app.tools.data import load_prospects


def run_discovery(task: SDRTask) -> dict:
    task.require_stage("search_prospects")
    market = task.plan.get("market", "US")
    rows = load_prospects()
    matched = [r for r in rows if r.get("market", "").upper() == market.upper() or not rows]
    if not rows:
        matched = []
    task.prospects = matched
    task.advance("prospect_discovery")
    return {"found": len(task.prospects), "prospects": task.prospects, "stage": task.stage}