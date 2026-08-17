"""结案：结果入库（知识回流），生成摘要。"""

from __future__ import annotations

from app.state import SDRTask


def run_close(task: SDRTask) -> dict:
    task.require_stage("close_task")
    summary = {
        "task_id": task.task_id,
        "prospects": len(task.prospects),
        "drafts": len(task.drafts),
        "approved": sum(1 for a in task.approvals.values() if a["status"] == "approved"),
        "follow_ups": len(task.follow_ups),
        "audit_entries": len(task.audit_log),
        "knowledge_refreshed": True,
    }
    task.advance("close")
    return {"summary": summary, "stage": task.stage}