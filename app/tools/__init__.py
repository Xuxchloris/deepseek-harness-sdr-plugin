"""工具注册表：agent 可调用的全部工具（deps = SDRTask）。

每个工具是显式类型签名的 async 函数，Pydantic AI 据此生成精确的参数 schema；
阶段前置校验（require_stage）保证流程不可乱序、邮件不可未批先发。

业务拒绝（StageError / ApprovalError）不中断 run：转成 {"error": ...} 正常返回
给模型，让它看到原因自行调整（框架级审计照常记录每次调用）。

注意：approve_email 不属于 agent 工具——批准只能由人工通过 API 完成，
模型绝不能自我批准。
"""

from __future__ import annotations

import urllib.parse

from pydantic_ai import RunContext
from pydantic_ai.common_tools.web_fetch import WebFetchLocalTool
from pydantic_ai.tools import Tool

from app.state import ApprovalError, SDRTask, StageError
from app.tools import close, discovery, email, gates, planning, quotation, research, scoring


async def plan_task(ctx: RunContext[SDRTask]) -> dict:
    """阶段1 任务解析：LLM 从自然语言任务提取市场/产品/数量。"""
    try:
        return await planning.run_plan(ctx.deps)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def search_prospects(ctx: RunContext[SDRTask]) -> dict:
    """阶段2 客户发现：从样例库匹配候选客户（真实项目接 Apollo MCP）。"""
    try:
        return discovery.run_discovery(ctx.deps)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def research_company(ctx: RunContext[SDRTask]) -> dict:
    """阶段3 公司背调：为每位候选客户抽取公开证据。"""
    try:
        return research.run_research(ctx.deps)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def score_prospects(ctx: RunContext[SDRTask]) -> dict:
    """阶段4 客户评分：按产品匹配/渠道价值/市场权重打分排序。"""
    try:
        return scoring.run_scoring(ctx.deps)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def draft_email(ctx: RunContext[SDRTask], limit: int = 3) -> dict:
    """阶段5 开发信草稿：LLM 生成 + 合规校验（不合规重写/丢弃）。

    limit: 最多生成多少封草稿。
    """
    try:
        return await email.run_draft(ctx.deps, limit=limit)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def request_approval(ctx: RunContext[SDRTask], email_id: str) -> dict:
    """阶段6 提交人工审批：把指定开发信挂起等批准。

    email_id: 开发信编号（来自 draft_email 的 draft_ids）。
    """
    try:
        return gates.request_approval(ctx.deps, email_id)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def send_email(ctx: RunContext[SDRTask], email_id: str) -> dict:
    """发送开发信。红线：未经批准的开发信一律拒绝（返回 error），绝不自动发送。

    email_id: 开发信编号，必须已由人工批准。
    """
    try:
        return gates.send_email(ctx.deps, email_id)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def advance_after_approval(ctx: RunContext[SDRTask]) -> dict:
    """阶段6 收尾：确认待批项全部批准后，推进到跟进计划阶段。

    仍有未批准开发信时返回 error（人工审批是硬卡点）。
    """
    try:
        return gates.advance_after_approval(ctx.deps)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def plan_follow_ups(ctx: RunContext[SDRTask]) -> dict:
    """阶段7 跟进计划：按评分优先级排跟进任务与时间表。"""
    try:
        return planning.run_followups(ctx.deps)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def build_quotation_pack(ctx: RunContext[SDRTask]) -> dict:
    """阶段8 报价素材包：生成报价所需产品资料清单。"""
    try:
        return quotation.run_quotation(ctx.deps)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def close_task(ctx: RunContext[SDRTask]) -> dict:
    """阶段9 结案：结果入库（知识回流），产出交付摘要。"""
    try:
        return close.run_close(ctx.deps)
    except (StageError, ApprovalError) as e:
        return {"error": str(e)}


async def web_fetch(url: str) -> dict:
    """抓取网页内容并转成 markdown。url: 完整 URL（http/https）。"""
    try:
        r = await WebFetchLocalTool(
            max_content_length=50000, allow_local_urls=False, timeout=30
        )(url)
        if isinstance(r, dict):
            return {"url": r.get("url"), "title": r.get("title"), "content": r.get("content")}
        return {"error": "内容为二进制，暂不支持"}
    except Exception as e:
        return {"error": f"web_fetch 失败: {e}"}


async def web_search(query: str) -> dict:
    """网页搜索：抓 Bing 搜索结果（国内可达、免 key），返回前几条标题/链接/摘要。"""
    url = f"https://www.bing.com/search?q={urllib.parse.quote(query)}&count=10"
    try:
        from bs4 import BeautifulSoup
        import httpx

        async with httpx.AsyncClient(
            timeout=20,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        for li in soup.select("li.b_algo"):
            a = li.find("a", href=True)
            if not a:
                continue
            href = a.get("href", "")
            if not href.startswith("http"):
                continue
            title = a.get_text(strip=True)
            cap = li.select_one(".b_caption p") or li.select_one("p")
            results.append(
                {"title": title, "href": href, "body": cap.get_text(strip=True) if cap else ""}
            )
        return {"query": query, "results": results[:8]}
    except Exception as e:
        return {"error": f"搜索失败: {e}"}


# 顺序即 SOP 展示顺序；approve_email 故意不在其中
TOOL_FUNCS: dict[str, callable] = {
    "plan_task": plan_task,
    "search_prospects": search_prospects,
    "research_company": research_company,
    "score_prospects": score_prospects,
    "draft_email": draft_email,
    "request_approval": request_approval,
    "send_email": send_email,
    "advance_after_approval": advance_after_approval,
    "plan_follow_ups": plan_follow_ups,
    "build_quotation_pack": build_quotation_pack,
    "close_task": close_task,
}


def build_tools() -> list[Tool]:
    """Agent 用的全部工具（不含 approve_email），含通用 web_fetch / 网页搜索。"""
    return [*TOOL_FUNCS.values(), web_fetch, web_search]


def tool_names() -> list[str]:
    return list(TOOL_FUNCS)


__all__ = ["build_tools", "tool_names", "TOOL_FUNCS"]
