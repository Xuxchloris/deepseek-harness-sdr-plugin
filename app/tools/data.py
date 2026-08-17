"""内部数据读取：合成样例客户 / RAG 知识库（历史开发信、案例）。

不联网、不读真实客户数据，全部来自 scripts/sample_data.py 生成。
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
KB = ROOT / "data" / "knowledge"


def load_prospects() -> list[dict]:
    path = RAW / "prospects.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def load_email_drafts() -> list[dict]:
    return _load_json(KB / "email_drafts.json")


def load_case_notes() -> list[dict]:
    return _load_json(KB / "case_notes.json")


def _load_json(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return json.load(f)