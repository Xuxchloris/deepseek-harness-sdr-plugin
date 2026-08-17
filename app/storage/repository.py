"""Small SQLite repository for tasks shared by MCP, HTTP, and Feishu workers."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.state import SDRTask


def _payload(task: SDRTask) -> dict:
    data = task.to_dict()
    # to_dict intentionally exposes a compact status map; persistence keeps the
    # approver and timestamps needed to validate a release later.
    data["approvals"] = task.approvals
    return data


def _task_from_payload(data: dict) -> SDRTask:
    task = SDRTask(
        task_id=data.get("task_id", "restored"),
        task=data.get("task", ""),
        market=data.get("market", ""),
        product=data.get("product", ""),
        stage=data.get("stage", "task_parse"),
    )
    for key in ("plan", "research", "scores"):
        setattr(task, key, data.get(key, {}))
    for key in ("prospects", "drafts", "follow_ups", "quotation_pack", "audit_log"):
        setattr(task, key, data.get(key, []))
    approvals = data.get("approvals", {})
    task.approvals = {
        key: ({"status": value} if isinstance(value, str) else value)
        for key, value in approvals.items()
    }
    return task


class TaskRepository:
    """SQLite-backed repository with JSON payloads to preserve SDRTask shape."""

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path or Path(__file__).resolve().parents[2] / "data" / "exports" / "sdr_tasks.sqlite3")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS tasks ("
                "task_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)"
            )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def save(self, task: SDRTask) -> SDRTask:
        payload = json.dumps(_payload(task), ensure_ascii=False, separators=(",", ":"))
        updated = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO tasks(task_id, payload, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(task_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
                (task.task_id, payload, updated),
            )
        return task

    def get(self, task_id: str) -> SDRTask | None:
        with self._connect() as conn:
            row = conn.execute("SELECT payload FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        return _task_from_payload(json.loads(row["payload"])) if row else None

    def list(self) -> list[SDRTask]:
        with self._connect() as conn:
            rows = conn.execute("SELECT payload FROM tasks ORDER BY updated_at DESC").fetchall()
        return [_task_from_payload(json.loads(row["payload"])) for row in rows]
