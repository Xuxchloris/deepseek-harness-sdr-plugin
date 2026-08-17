"""Offline end-to-end demonstration of the DSH SDR adapter."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from app.mcp import server
from app.storage.repository import TaskRepository
from app.tools import gates


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="dsh-sdr-demo-") as directory:
        server.REPO = TaskRepository(Path(directory) / "tasks.sqlite3")
        created = server.create_task("开发 3 个美国户外用品客户")
        task_id = created["task_id"]
        print(f"created {task_id}: {created['stage']}")

        for stage in (
            "task_parse",
            "prospect_discovery",
            "company_research",
            "prospect_scoring",
            "email_draft",
            "human_approval",
        ):
            result = asyncio.run(server.run_sdr_stage(task_id, stage))
            print(f"stage {stage}: {result['task']['stage']}")

        blocked = server.advance_after_approval(task_id)
        print(f"before approval: {blocked['error']}")
        pending = server.get_pending_drafts(task_id)["drafts"]
        for draft in pending:
            task = server.REPO.get(task_id)
            assert task is not None
            gates.approve_email(task, draft["email_id"], approver="demo-user", draft_hash=draft["draft_hash"])
            server.REPO.save(task)
        advanced = server.advance_after_approval(task_id)
        print(f"after approval: {advanced['task']['stage']}")

        for stage in ("follow_up_plan", "quotation_pack", "close"):
            result = asyncio.run(server.run_sdr_stage(task_id, stage))
            print(f"stage {stage}: {result['task']['stage']}")

        audit = server.get_audit_log(task_id)
        print(f"audit entries: {audit['count']}")
        print(f"final report: {server.get_task(task_id)}")


if __name__ == "__main__":
    main()
