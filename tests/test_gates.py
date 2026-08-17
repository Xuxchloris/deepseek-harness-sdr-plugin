import pytest

pytest.importorskip("pydantic_ai")

from app.state import ApprovalError, SDRTask
from app.storage.repository import TaskRepository
from app.tools import gates


def task_at_approval():
    return SDRTask(
        task_id="T-test",
        task="开发客户",
        stage="human_approval",
        drafts=[{"email_id": "draft_01", "subject": "报价", "body": "正文"}],
    )


def test_advance_requires_human_approval():
    task = task_at_approval()
    gates.request_approval(task, "draft_01")
    with pytest.raises(ApprovalError):
        gates.advance_after_approval(task)


def test_approval_is_bound_to_immutable_draft_hash():
    task = task_at_approval()
    gates.request_approval(task, "draft_01")
    task.drafts[0]["body"] = "被修改的正文"
    with pytest.raises(ApprovalError):
        gates.approve_email(task, "draft_01")


def test_approval_metadata_survives_sqlite_round_trip(tmp_path):
    repo = TaskRepository(tmp_path / "tasks.sqlite3")
    task = task_at_approval()
    gates.request_approval(task, "draft_01")
    draft_hash = task.approvals["draft_01"]["draft_hash"]
    gates.approve_email(task, "draft_01", approver="reviewer", draft_hash=draft_hash)
    repo.save(task)

    restored = repo.get("T-test")
    assert restored is not None
    assert restored.approvals["draft_01"]["status"] == "approved"
    assert restored.approvals["draft_01"]["draft_hash"] == draft_hash
    assert gates.advance_after_approval(restored)["stage"] == "follow_up_plan"
