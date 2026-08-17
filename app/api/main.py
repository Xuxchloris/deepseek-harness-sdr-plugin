"""ai-sdr API 入口：任务管理 + 审批端点。飞书机器人由独立进程运行。"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.state import ApprovalError, SDRTask, StageError
from app.tools import gates

app = FastAPI(title="ai-sdr")

# 内存任务表 + 自增 task_id
TASKS: dict[str, SDRTask] = {}
_task_seq = 0


class TaskCreate(BaseModel):
    task: str
    market: str = ""
    product: str = ""


class ApproveBody(BaseModel):
    email_id: str
    approver: str = "manager"


class RunBody(BaseModel):
    prompt: str | None = None
    structured: bool = True


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/tasks")
def create_task(body: TaskCreate):
    global _task_seq
    _task_seq += 1
    task = SDRTask(
        task_id=f"T{_task_seq}",
        task=body.task,
        market=body.market,
        product=body.product,
        stage="task_parse",
    )
    task.audit("create_task", {"task": body.task})
    TASKS[task.task_id] = task
    return {"task_id": task.task_id, "stage": "task_parse", "status": "created"}


@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return {
        "task_id": task.task_id,
        "task": task.task,
        "market": task.market,
        "product": task.product,
        "stage": task.stage,
        "prospects": task.prospects,
        "prospects_count": len(task.prospects),
        "drafts": task.drafts,
        "drafts_count": len(task.drafts),
        "follow_ups": task.follow_ups,
        "approvals": task.approvals,
        "audit_log": task.audit_log,
    }


@app.post("/tasks/{task_id}/approve")
def approve(task_id: str, body: ApproveBody):
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    try:
        result = gates.approve_email(task, body.email_id, approver=body.approver)
    except (ApprovalError, StageError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "task_id": task.task_id,
        "email_id": result["email_id"],
        "status": result["status"],
    }


@app.post("/tasks/{task_id}/run")
async def run_task(task_id: str, body: RunBody):
    """执行 Agent 循环。首次跑到人工审批卡点；批准后再调（带 prompt 续跑）到结案。"""
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    from app.agent.agent import run_sdr
    from app.llm.client import get_model

    result = await run_sdr(
        task,
        model=get_model(),
        prompt=body.prompt,
        structured=body.structured,
    )
    return {
        "task_id": task.task_id,
        "stage": task.stage,
        "audit_entries": len(task.audit_log),
        "report": result.get("report"),
    }
