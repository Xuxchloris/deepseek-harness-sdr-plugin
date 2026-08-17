# dsh-sdr

`dsh-sdr` 是 ai-sdr 的 DeepSeek Harness（DSH）bundle，首个兼容目标为 DSH `0.1.0-rc.6`。它保留 `E:\ai-sdr\app` 中的 Python 状态机、RAG、护栏和工具实现，通过 MCP 把业务能力接入 DSH。

## 安装

在本仓库目录执行：

```powershell
dsh plugin --profile web add .\packages\dsh-sdr
```

bundle 安装器会把随包的 preset 安装到：

```text
$DSH_HOME/.agent-presets/sdr
```

Windows 上未设置 `DSH_HOME` 时，默认是 `%USERPROFILE%\.dsh\.agent-presets\sdr`。已有同名且没有 `.dsh-sdr-managed.json` 标记的 preset 不会被覆盖。

先启动 Python MCP 服务，再重启 `dsh web`，新建会话时即可选择「SDR 数字员工」。MCP 不可用时 preset 会拒绝挂载，避免 Agent 在没有业务工具的情况下虚构阶段进度。preset 只对新建或空白会话生效。

## 运行

```powershell
$env:DSH_SDR_DRY_RUN = '1'
python -m app.mcp.server --transport streamable-http
dsh web
```

没有外部凭证时，发现、背调、评分、报价和邮件均使用合成数据或 draft-only；Python 的 `send_email` 出口仍会拒绝没有结构化批准凭证的调用。

## 架构

```text
DSH Web / SDR preset
        |
        | MCP tools + native sdr_review_drafts
        v
Python FastMCP :8765  ---- SQLite task repository
        |
        +-- app/state.py 9-stage state machine
        +-- RAG / guardrails / discovery / research / scoring / quotation
        +-- gates.py: draft hash + human approval + draft-only send
```

`sdr_review_drafts` 不向模型提供 approve/send 工具。它读取 loopback 控制端点，在 DSH 原生 user-questions provider 中等待人类选择，再提交带草稿哈希的批准记录；`advance_after_approval` 仍由 Python 门控做最终检查。

## 与原项目的关系

- `app/` 是原 ai-sdr 业务代码，继续可通过 FastAPI、飞书机器人和 Pydantic AI Agent 使用。
- `packages/dsh-sdr/` 是 DSH 适配层，不替换原有 Agent 循环。
- `export_skills/`（如后续存在）属于技能导出物，不是 DSH bundle 的运行时依赖；本包只依赖 DSH 的 Cordis/MCP 接口。

本包和原项目均按 MIT 许可证发布；不包含 `.env`、客户数据或 API key。
