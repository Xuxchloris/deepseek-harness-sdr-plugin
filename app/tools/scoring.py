"""阶段4 客户评分：产品匹配度 + 渠道价值 + 市场权重，产出排序。"""

from __future__ import annotations

from app.state import SDRTask


def run_scoring(task: SDRTask) -> dict:
    task.require_stage("score_prospects")
    product_kw = task.plan.get("product", "")[:2]
    scores = {}
    for p in task.prospects:
        biz = (p.get("biz_type") or "").lower()
        match = 80 if product_kw and product_kw.lower() in biz else 55
        channel = 30 if ("distributor" in biz or "importer" in biz or "wholesaler" in biz) else 20
        market = 10 if p.get("market", "").upper() == task.plan.get("market", "US").upper() else 5
        scores[p["company"]] = {"score": match + channel + market, "product_match": match}
    task.scores = dict(sorted(scores.items(), key=lambda kv: kv[1]["score"], reverse=True))
    task.advance("prospect_scoring")
    return {"scores": task.scores, "stage": task.stage}