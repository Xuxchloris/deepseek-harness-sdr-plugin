"""审批门控：开发信必须人工审批，未经批准永远无法发送。

红线：send_email 只是「获批后的发送」，并且即便获批也默认走
「草稿/待发队列」——skeleton 阶段绝不真的发信。
"""

from __future__ import annotations

from app.state import ApprovalError, SDRTask


def request_approval(task: SDRTask, email_id: str) -> dict:
    task.require_stage("request_approval")
    if email_id not in {d["email_id"] for d in task.drafts}:
        raise ApprovalError(f"开发信 {email_id} 不存在，无法提交审批")
    task.approvals[email_id] = {"status": "pending", "approver": None}
    return {"email_id": email_id, "status": "pending", "message": "已提交审批"}


def approve_email(task: SDRTask, email_id: str, approver: str = "manager") -> dict:
    task.require_stage("approve_email")
    rec = task.approvals.get(email_id)
    if not rec or rec["status"] != "pending":
        raise ApprovalError(f"开发信 {email_id} 不在待审批状态")
    rec["status"] = "approved"
    rec["approver"] = approver
    task.audit("approve_email", {"email_id": email_id, "approver": approver})
    return {"email_id": email_id, "status": "approved"}


def send_email(task: SDRTask, email_id: str) -> dict:
    """唯一发送出口。没有 approved 凭证直接拒绝——绝不自动发送。"""
    task.require_stage("send_email")
    rec = task.approvals.get(email_id)
    if not rec or rec["status"] != "approved":
        raise ApprovalError(f"开发信 {email_id} 未经审批，禁止发送（红线）")
    return {"email_id": email_id, "status": "queued", "mode": "draft-only"}


def advance_after_approval(task: SDRTask) -> dict:
    """全部待批项批准后才推进到 follow_up_plan（人工审批是硬卡点）。"""
    task.require_stage("advance_after_approval")
    pending = [
        d["email_id"]
        for d in task.drafts
        if task.approvals.get(d["email_id"], {}).get("status") != "approved"
    ]
    if pending:
        raise ApprovalError(f"仍有 {len(pending)} 封开发信待人工审批：{pending}")
    task.advance("human_approval")
    return {"stage": task.stage, "approved": len(task.drafts)}