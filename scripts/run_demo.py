"""一键演示：真实 DeepSeek 跑通外贸 SDR 全流程。

阶段1 自主执行（实时打印工具调用与结果）→ 模拟人工审批 → 阶段2 续跑至结案
→ 结构化结案报告 + 框架级审计 + 状态落盘。

用法：python scripts/run_demo.py [任务描述]
前置：.env 配好 DeepSeek key；先跑 scripts/sample_data.py 生成样例数据。
例：python scripts/run_demo.py "开发 5 个德国户外用品客户"
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv()

from app.agent.agent import build_agent, build_report_agent, run_sdr_stream
from app.llm.client import get_model
from app.state import SDRTask, save_task
from app.tools import gates


async def run_phase(label: str, task: SDRTask, agent, prompt: str | None = None) -> None:
    print(f"\n== {label} ==")
    async for ev in run_sdr_stream(task, agent=agent, prompt=prompt):
        t = ev["type"]
        if t == "tool_call":
            print(f"  [调用] {ev['tool']} {ev.get('args')}")
        elif t == "tool_result":
            r = ev.get("result")
            if isinstance(r, dict) and r.get("error"):
                print(f"  [结果] {ev['tool']} -> 拒绝: {r['error'][:60]}")
            else:
                print(f"  [结果] {ev['tool']} -> {str(r)[:70]}")
        elif t == "done":
            print(f"  [完成] 阶段: {ev.get('stage')}")


async def main() -> None:
    task_text = sys.argv[1] if len(sys.argv) > 1 else "开发 3 个美国户外用品客户"
    task = SDRTask(task_id="demo1", task=task_text)
    agent = build_agent(model=get_model())

    await run_phase("阶段1: 自主执行（到人工审批卡点）", task, agent)

    pending = [
        d["email_id"]
        for d in task.drafts
        if task.approvals.get(d["email_id"], {}).get("status") != "approved"
    ]
    print(f"\n模拟人工批准 {len(pending)} 封（真实场景走 API /approve）...")
    for eid in pending:
        gates.approve_email(task, eid, approver="demo-manager")

    await run_phase(
        "阶段2: 续跑至结案",
        task,
        agent,
        "人工审批已全部完成。请调用 advance_after_approval 确认批准完成，然后依次执行跟进计划、报价素材、结案，直到任务结束。",
    )

    rep = await build_report_agent(model=get_model()).run(
        f"任务 {task.task_id} 已执行到阶段 {task.stage}。"
        f"请根据以下执行摘要生成结案报告:\n"
        f"{json.dumps(task.to_dict(), ensure_ascii=False, indent=2, default=str)}"
    )
    print("\n== 结构化结案报告 ==")
    print(rep.output.model_dump_json(indent=2, ensure_ascii=False))

    print(f"\n== 框架级审计（{len(task.audit_log)} 条）==")
    for e in task.audit_log:
        print(" ", e["stage"], "|", e["action"], "|", str(e["detail"])[:70])

    save_task(task)
    print("\n状态已落盘: data/exports/last_task.json")


if __name__ == "__main__":
    asyncio.run(main())
