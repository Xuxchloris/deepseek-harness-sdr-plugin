"""结构化输出模型：结案报告（由报告子 Agent 产出，类型安全可落库）。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class TopProspect(BaseModel):
    company: str = Field(description="公司名")
    score: int = Field(description="综合评分")
    product_match: int = Field(description="产品匹配度")


class SDRReport(BaseModel):
    task_id: str = Field(description="任务编号")
    market: str = Field(description="目标市场")
    product: str = Field(description="产品")
    prospects_total: int = Field(description="找到的候选客户数")
    drafts_total: int = Field(description="生成的开发信草稿数")
    approved_emails: int = Field(description="已人工批准的邮件数")
    follow_ups_total: int = Field(description="跟进计划条数")
    top_prospects: list[TopProspect] = Field(description="评分最高的客户")
    next_steps: list[str] = Field(description="建议的后续动作")
    summary: str = Field(description="一句话总结")


class DraftEmail(BaseModel):
    company: str = Field(description="目标客户公司名")
    subject: str = Field(description="邮件主题")
    body: str = Field(description="邮件正文")


class Plan(BaseModel):
    market: str = Field(description="目标市场，如 US / EU / JP")
    product: str = Field(description="核心产品/品类，简短名词")
    target_count: int = Field(description="目标客户数量，未提及填 0")


class Intent(BaseModel):
    is_task: bool = Field(description="是否是一个可执行的客户开发任务")
    reason: str = Field(description="判断理由（一句话）")
    task_summary: str | None = Field(default=None, description="如果是任务，一句话概括要干什么")
