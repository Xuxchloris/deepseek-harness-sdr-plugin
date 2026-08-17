"""阶段1 任务解析（LLM 自然语言理解）+ 阶段7 跟进计划。"""

from __future__ import annotations

import re

from pydantic_ai import Agent

from app.schemas import Plan
from app.state import SDRTask
from app.tools.data import load_prospects

PARSE_PROMPT = (
    "你是外贸任务解析器。从用户的自然语言任务里提取："
    "目标市场（US/EU/JP 等标准代码）、核心产品/品类（简短名词）、"
    "目标客户数量（整数，未提及填 0）。只输出提取到的字段，不要编造。"
)


async def _parse_plan(model, text: str) -> Plan:
    agent = Agent(model, output_type=Plan, system_prompt=PARSE_PROMPT, name="ai-sdr-parse")
    result = await agent.run(text)
    return result.output


async def run_plan(task: SDRTask) -> dict:
    task.require_stage("plan_task")
    text = task.task
    try:
        from app.llm.client import get_model  # 惰性取模型

        plan = await _parse_plan(get_model(), text)
        market = task.market or plan.market or "US"
        product = task.product or plan.product
        count = plan.target_count
    except Exception:
        # 模型不可用时回退到规则解析
        market = task.market or _find_market(text)
        product = task.product or text.split("客户", 1)[0].strip() or "户外用品"
        count = _find_count(text)

    task.plan = {
        "submit": text,
        "market": market,
        "product": product,
        "target_count": count,
        "available_prospects": len(load_prospects()),
    }
    task.advance("task_parse")
    return {"plan": task.plan, "stage": task.stage}


def run_followups(task: SDRTask) -> dict:
    task.require_stage("plan_follow_ups")
    follow_ups = []
    for rank, company in enumerate(task.scores, start=1):
        score = task.scores[company]["score"]
        follow_ups.append({
            "company": company,
            "rank": rank,
            "score": score,
            "next_action": "send_approved_email" if rank == 1 else "warm_up_sequence",
            "in_days": 1 if score >= 120 else 3,
        })
    task.follow_ups = follow_ups
    task.advance("follow_up_plan")
    return {"follow_ups": task.follow_ups, "stage": task.stage}


def _find_market(text: str) -> str:
    for kw in ("美国", "欧盟", "欧洲", "日本", "东南亚"):
        if kw in text:
            return {"美国": "US", "欧盟": "EU", "欧洲": "EU", "日本": "JP", "东南亚": "SEA"}[kw]
    return "US"


def _find_count(text: str) -> int:
    m = re.search(r"(\d+)\s*个", text)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)家", text)
    return int(m.group(1)) if m else 0
