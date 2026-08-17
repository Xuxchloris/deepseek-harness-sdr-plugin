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

## DeepSeek Harness 插件

本仓库包含可安装的 `dsh-sdr` bundle，首个兼容目标是 DSH `0.1.0-rc.6`。它把 DSH 作为外层 Agent loop，把本项目 Python 代码作为 MCP 业务服务，保留原有 FastAPI、飞书和 Pydantic AI 用法。

```powershell
dsh plugin --profile web add .\packages\dsh-sdr
$env:DSH_SDR_DRY_RUN = '1'
python -m app.mcp.server --transport streamable-http
dsh web
```

bundle 安装器管理的 preset 目录是 `$DSH_HOME/.agent-presets/sdr`（Windows 默认 `%USERPROFILE%\\.dsh\\.agent-presets\\sdr`）。重启后新建会话，在模式菜单选择「SDR 数字员工」。安装器不会覆盖没有 `.dsh-sdr-managed.json` 标记的同名用户 preset。

邮件流程是结构性门控：公共 MCP 不提供批准或发送工具；原生审批工具必须等待人类选择；Python `gates.py` 绑定草稿哈希并在未批准或内容变化时拒绝推进。默认无凭证 dry-run，发送出口只产生 draft-only 队列状态。

端到端离线演示：

```powershell
python scripts/demo_dsh_sdr.py
```

迁移边界、rc.6 API 风险和当前完成度见 [`docs/迁移方案.md`](docs/迁移方案.md)，插件安装说明见 [`packages/dsh-sdr/README.md`](packages/dsh-sdr/README.md)。`app/` 延续原 ai-sdr；`export_skills` 是历史技能导出项目，不是本 bundle 的运行时依赖。

## 合规

邮件默认只生成草稿，绝不自动发送；发送必须人工审批且逐封确认。
不编造客户事实；API key 走环境变量；数据全部为合成样例。
详见 `项目计划书.md`。
