# ai-sdr — 外贸获客 AI 员工

派一条任务"开发 50 个美国户外用品客户"，AI 员工自动跑完：
**找客户 → 背调 → 评分 → 个性化开发信草稿 → 人工审批 → 跟进计划 → 报价素材**，
全程轨迹可回放，在飞书里接单与审批。

## 技术栈

- Pydantic AI（Agent 循环 + MCP 插件）· Qwen2.5-7B + vLLM · bge-m3 + FAISS（RAG）
- 工具门控审批（绝不自动发邮件）· FastAPI · 飞书开放平台 · Docker

> 框架选型：2026 共识「单 agent + 少工具用 loop 就够」，LangGraph 过重；
> Pydantic AI 是 MCP 支持最全、provider 中立的选择（V2，自研）。代码迭代过程见 `docs/`。

## 快速开始

```bash
pip install -r requirements.txt
cp .env.example .env        # 填入模型地址与飞书凭证
```

## 目录

```
config/     AI 员工定义（SOP/工具白名单/审批规则）与产品/市场/语调配置
app/state.py   SDRTask 阶段机（替代外部状态机）
app/tools/     工具层（9 阶段工具 + 门控审批 + MCP 加载器）
app/rag/     bge-m3 + FAISS 检索
app/llm/     OpenAI 兼容端点客户端（Qwen/vLLM/DeepSeek）
app/api/     FastAPI 任务/审批/飞书回调
app/agent/    Agent 编排
app/feishu/  飞书机器人接入（占位）
```

## 合规

邮件默认只生成草稿，绝不自动发送；发送必须人工审批且逐封确认。
不编造客户事实；API key 走环境变量；数据全部为合成样例。
详见 `项目计划书.md`。
