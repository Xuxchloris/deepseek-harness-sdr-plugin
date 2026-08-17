"""SDR 任务状态对象 + 阶段机。

LangGraph 换成「LLM 主导 loop + 显式阶段机」：
agent 在循环里自由决策，但每个工具带阶段前置校验（gate），
到达审批点必须挂起等人工，邮件未经批准永远发不出去。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


STAGES = [
    "task_parse",
    "prospect_discovery",
    "company_research",
    "prospect_scoring",
    "email_draft",
    "human_approval",
    "follow_up_plan",
    "quotation_pack",
    "close",
]

# 工具 → 该工具允许执行的阶段
TOOL_SCOPE = {
    "plan_task": "task_parse",
    "search_prospects": "prospect_discovery",
    "research_company": "company_research",
    "score_prospects": "prospect_scoring",
    "draft_email": "email_draft",
    "request_approval": "human_approval",
    "approve_email": "human_approval",
    "send_email": "human_approval",
    "advance_after_approval": "human_approval",
    "plan_follow_ups": "follow_up_plan",
    "build_quotation_pack": "quotation_pack",
    "close_task": "close",
}


class StageError(Exception):
    """阶段前置条件不满足（工具被错误顺序/越权调用）。"""


class ApprovalError(Exception):
    """审批门控拒绝。"""


@dataclass
class SDRTask:
    task_id: str
    task: str
    market: str = ""
    product: str = ""
    stage: str = "task_parse"
    plan: dict[str, Any] = field(default_factory=dict)
    prospects: list[dict[str, Any]] = field(default_factory=list)
    research: dict[str, Any] = field(default_factory=dict)
    scores: dict[str, Any] = field(default_factory=dict)
    drafts: list[dict[str, Any]] = field(default_factory=list)
    approvals: dict[str, dict[str, Any]] = field(default_factory=dict)
    follow_ups: list[dict[str, Any]] = field(default_factory=list)
    quotation_pack: list[dict[str, Any]] = field(default_factory=list)
    audit_log: list[dict[str, Any]] = field(default_factory=list)

    def audit(self, action: str, detail: dict[str, Any] | None = None) -> None:
        self.audit_log.append({"stage": self.stage, "action": action, "detail": detail or {}})

    def require_stage(self, tool: str) -> None:
        allowed = TOOL_SCOPE.get(tool, "")
        if self.stage not in allowed:
            raise StageError(
                f"工具 {tool} 仅在阶段 {allowed!r} 可用，当前阶段 {self.stage!r}"
            )

    def advance(self, expected: str | None = None) -> str:
        if expected is not None and self.stage != expected:
            raise StageError(f"预期阶段 {expected!r}，当前 {self.stage!r}")
        idx = STAGES.index(self.stage)
        nxt = STAGES[min(idx + 1, len(STAGES) - 1)]
        self.stage = nxt
        return self.stage

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "task": self.task,
            "market": self.market,
            "product": self.product,
            "stage": self.stage,
            "plan": self.plan,
            "prospects": self.prospects,
            "research": self.research,
            "scores": self.scores,
            "drafts": self.drafts,
            "approvals": {k: v["status"] for k, v in self.approvals.items()},
            "follow_ups": self.follow_ups,
            "quotation_pack": self.quotation_pack,
            "audit_log": self.audit_log,
        }


DEFAULT_EXPORT = Path(__file__).resolve().parent.parent / "data" / "exports" / "last_task.json"


def save_task(task: SDRTask, path: str | Path | None = None) -> Path:
    """持久化任务状态（供每步断点落盘 / 恢复）。"""
    p = Path(path) if path is not None else DEFAULT_EXPORT
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(task.to_dict(), ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    return p


def load_task(path: str | Path | None = None) -> SDRTask | None:
    """从磁盘恢复任务状态。"""
    p = Path(path) if path is not None else DEFAULT_EXPORT
    if not p.exists():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    task = SDRTask(
        task_id=data.get("task_id", "restored"),
        task=data.get("task", ""),
        market=data.get("market", ""),
        product=data.get("product", ""),
        stage=data.get("stage", "task_parse"),
    )
    for key in ("plan", "research", "scores"):
        task.__dict__[key] = data.get(key, {})
    for key in ("prospects", "drafts", "follow_ups", "quotation_pack", "audit_log"):
        task.__dict__[key] = data.get(key, [])
    approvals = data.get("approvals", {})
    task.approvals = {
        k: {"status": v} if isinstance(v, str) else v for k, v in approvals.items()
    }
    return task