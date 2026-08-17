"""阶段3 公司背调：为每位客户抽取公开网页证据（骨架阶段用样例数据字段模拟，
真实项目接 AdsPower 浏览器 MCP + 网页抓取）。"""

from __future__ import annotations

from app.state import SDRTask


def run_research(task: SDRTask) -> dict:
    task.require_stage("research_company")
    research = {}
    for p in task.prospects:
        company = p["company"]
        biz_type = p.get("biz_type", "")
        research[company] = {
            "business": biz_type,
            "evidence": [p.get("website", "")],
            "snippet": f"{company} 主营 {biz_type}",
        }
    task.research = research
    task.advance("company_research")
    return {"researched": len(research), "stage": task.stage}