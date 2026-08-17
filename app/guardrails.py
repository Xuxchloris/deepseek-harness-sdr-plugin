"""合规校验器（Guardrails）：开发信不得编造联系信息 / 采购意向。

红线工程化：草稿违反校验 → 工具抛错让模型重写；重写仍不合规则丢弃不入库。
"""

from __future__ import annotations

import re

# 疑似编造的联系信息（联系人/电话/邮箱/即时通讯）
CONTACT_PATTERNS = [
    r"\b(Tel|Phone|Mobile|Fax|WeChat|WhatsApp|Skype|Email|E-mail)\b\s*[:：]?\s*[\w@.+ -]{4,}",
    r"\b(Mr\.|Ms\.|Mrs\.|Dr\.)\s+[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)?",
    r"联系人\s*[:：]\s*\S+",
    r"(电话|手机|微信号)\s*[:：]?\s*\d[\d\- ]{6,}",
]

# 疑似编造的采购意向 / 承诺
INTENT_PATTERNS = [
    r"(正在|已|即将)\s*(评估|洽谈|推进).{0,6}(采购|下单|合作|订购)",
    r"(有|存在)(强烈|明确|很大|初步).{0,4}(意向|需求|兴趣)",
    r"(确认|承诺|保证).{0,10}(下单|采购|合作)",
    r"订单\s*[数金额量]",
    r"(本月|本季度|今年)\s*.{0,6}(下单|采购)\s*计划",
]


def draft_violations(subject: str, body: str) -> list[str]:
    """返回草稿的合规问题列表；空列表表示通过。"""
    text = f"{subject}\n{body}"
    issues: list[str] = []
    for pat in CONTACT_PATTERNS:
        if re.search(pat, text, re.IGNORECASE):
            issues.append(f"疑似编造联系信息：{pat}")
    for pat in INTENT_PATTERNS:
        if re.search(pat, text, re.IGNORECASE):
            issues.append(f"疑似编造采购意向：{pat}")
    return issues
