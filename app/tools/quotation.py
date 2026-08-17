"""阶段8 报价素材包：检索产品库/历史报价，生成报价所需素材。"""

from __future__ import annotations

from app.state import SDRTask
from app.tools.data import load_email_drafts


def run_quotation(task: SDRTask) -> dict:
    task.require_stage("build_quotation_pack")
    lib = load_email_drafts()
    pack = []
    for company in list(task.follow_ups or task.scores):
        pack.append({
            "company": company if isinstance(company, str) else company.get("company"),
            "product": task.plan.get("product", "Portable Power Station 300W"),
            "docs": ["catalog.pdf", "CE_FCC_cert.pdf", "price_list.xlsx"],
            "reference": [d["prospect"] for d in lib if company in d["prospect"]][:1] if isinstance(company, str) else [],
        })
    task.quotation_pack = pack
    task.advance("quotation_pack")
    return {"pack": task.quotation_pack, "stage": task.stage}