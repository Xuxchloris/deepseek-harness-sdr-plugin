"""审批门控：开发信必须人工审批，未经批准永远无法发送。

红线：send_email 只是「获批后的发送」，并且即便获批也默认走
「草稿/待发队列」——skeleton 阶段绝不真的发信。
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from app.state import ApprovalError, SDRTask


def draft_fingerprint(task: SDRTask, email_id: str) -> str:
    draft = next((item for item in task.drafts if item.get("email_id") == email_id), None)
    if draft is None:
        raise ApprovalError(f"开发信 {email_id} 不存在")
    raw = f"{draft.get('subject', '')}\n{draft.get('body', '')}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def request_approval(task: SDRTask, email_id: str) -> dict:
    task.require_stage("request_approval")
    fingerprint = draft_fingerprint(task, email_id)
    existing = task.approvals.get(email_id)
    if existing and existing.get("status") == "approved":
        return {"email_id": email_id, "status": "approved", "message": "已批准"}
    task.approvals[email_id] = {
        "status": "pending",
        "approver": None,
        "draft_hash": fingerprint,
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"email_id": email_id, "status": "pending", "message": "已提交审批"}


def approve_email(
    task: SDRTask,
    email_id: str,
    approver: str = "manager",
    draft_hash: str | None = None,
    source: str = "human",
) -> dict:
    task.require_stage("approve_email")
    rec = task.approvals.get(email_id)
    if not rec or rec["status"] != "pending":
        raise ApprovalError(f"开发信 {email_id} 不在待审批状态")
    expected = draft_fingerprint(task, email_id)
    if draft_hash is not None and draft_hash != expected:
        raise ApprovalError(f"开发信 {email_id} 内容已变化，审批凭证失效")
    if rec.get("draft_hash") not in (None, expected):
        raise ApprovalError(f"开发信 {email_id} 的待审批版本已变化")
    rec["status"] = "approved"
    rec["approver"] = approver
    rec["draft_hash"] = expected
    rec["source"] = source
    rec["approved_at"] = datetime.now(timezone.utc).isoformat()
    task.audit("approve_email", {"email_id": email_id, "approver": approver, "source": source})
    return {"email_id": email_id, "status": "approved"}


def send_email(task: SDRTask, email_id: str) -> dict:
    """唯一发送出口。没有 approved 凭证直接拒绝——绝不自动发送。"""
    task.require_stage("send_email")
    rec = task.approvals.get(email_id)
    if not rec or rec["status"] != "approved":
        raise ApprovalError(f"开发信 {email_id} 未经审批，禁止发送（红线）")
    if rec.get("draft_hash") != draft_fingerprint(task, email_id):
        raise ApprovalError(f"开发信 {email_id} 内容已变化，禁止发送")
    return {"email_id": email_id, "status": "queued", "mode": "draft-only"}


def advance_after_approval(task: SDRTask) -> dict:
    """全部待批项批准后才推进到 follow_up_plan（人工审批是硬卡点）。"""
    task.require_stage("advance_after_approval")
    pending = [
        d["email_id"]
        for d in task.drafts
        if (
            task.approvals.get(d["email_id"], {}).get("status") != "approved"
            or task.approvals.get(d["email_id"], {}).get("draft_hash")
            != draft_fingerprint(task, d["email_id"])
        )
    ]
    if pending:
        raise ApprovalError(f"仍有 {len(pending)} 封开发信待人工审批：{pending}")
    task.advance("human_approval")
    return {"stage": task.stage, "approved": len(task.drafts)}
