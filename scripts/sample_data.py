"""生成合成样例数据：候选客户 + RAG 知识库。全部为演示数据。"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
KB = ROOT / "data" / "knowledge"

PROSPECTS = [
    {"company": "Summit Trail Goods", "website": "https://example-summittrail.com",
     "market": "US", "biz_type": "outdoor gear distributor", "note": "demo"},
    {"company": "Blue Ridge Camping Supply", "website": "https://example-blueridge.com",
     "market": "US", "biz_type": "camping equipment retailer", "note": "demo"},
    {"company": "Prairie Point Trading", "website": "https://example-prairiepoint.com",
     "market": "US", "biz_type": "sports outdoor wholesaler", "note": "demo"},
]

EMAIL_DRAFTS = [
    {
        "prospect": "Summit Trail Goods",
        "product": "Portable Power Station 300W",
        "body": "We supply a 300W power station (CE/FCC certified, MOQ 100).",
    },
]

CASE_NOTES = [
    {
        "title": "Cold email opener with company reference converts best",
        "detail": "Drafts referencing the prospect's product line outperform generic openers.",
    },
    {
        "title": "Quotation pack must include certifications",
        "detail": "EU prospects always ask for CE/RoHS documents before price discussion.",
    },
]


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    KB.mkdir(parents=True, exist_ok=True)
    with (RAW / "prospects.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(PROSPECTS[0].keys()))
        w.writeheader()
        w.writerows(PROSPECTS)
    (KB / "email_drafts.json").write_text(
        json.dumps(EMAIL_DRAFTS, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (KB / "case_notes.json").write_text(
        json.dumps(CASE_NOTES, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"样例数据已生成: {RAW} / {KB}")


if __name__ == "__main__":
    main()
