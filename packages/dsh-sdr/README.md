# dsh-sdr

`dsh-sdr` 是面向 DeepSeek Harness `0.1.0-rc.6` 的 SDR 数字员工 bundle。当前版本把 9 阶段业务编排、审批门控、客户去重和审计放在 Node.js 原生运行时中，DSH 只负责 Agent loop、工具调用和人机交互。不需要 Python MCP 服务，也不占用 `8765` 端口。

## 安装和重载

在本仓库目录执行：

```powershell
dsh plugin --profile web add "E:\ai-sdr\packages\dsh-sdr"
dsh web
```

如果插件已经安装过，先再次执行 `add` 让 Harness 重新读取本地 bundle，然后重启 `dsh web`。新建会话时，在模式菜单选择「SDR 数字员工」。rc.6 采用受管 preset 安装器，preset 会写入：

```text
$DSH_HOME/.agent-presets/sdr
```

Windows 未设置 `DSH_HOME` 时，默认是 `%USERPROFILE%\\.dsh\\.agent-presets\\sdr`。安装器不会覆盖没有 `.dsh-sdr-managed.json` 标记的同名 preset。

## 使用

在 SDR 模式中派单，例如：

```text
开发 3 个美国户外用品客户
```

Agent 会调用 `sdr_create_task`，然后重复调用 `sdr_next_step`。服务端决定当前阶段和合法的下一步，模型不能传入任意 stage 跳过流程。到达第 6 阶段后，`sdr_review_drafts` 会展示草稿并等待人工选择；之后 `sdr_continue_after_approval` 只有在全部草稿的当前哈希都有人工批准凭证时才会放行。

## 架构

```text
DSH Web / SDR preset
        |
        | native Cordis tools
        v
SdrService (Node.js)
        |
        +-- 9-stage state machine
        +-- JSON durable store (atomic writes)
        +-- Lead Registry + canonical dedupe
        +-- approval hash gate
        +-- audit event store
        +-- ConnectorRegistry
              +-- email      (dry-run)
              +-- whatsapp   (dry-run placeholder)
              +-- crm        (dry-run placeholder)
```

默认状态文件为 `%USERPROFILE%\\.dsh\\.dsh-sdr\\state.json`，也可以设置 `DSH_SDR_DATA_FILE` 指定路径。状态文件只保存本地合成演示数据，不需要凭证。未来可以把 `JsonStore` 换成 SQLite/PostgreSQL adapter，把 `ConnectorRegistry` 中的 dry-run connector 换成 SMTP/SES、WhatsApp Business API、HubSpot、Salesforce 或飞书实现，SOP 和审批工具接口不变。

## 结构性安全约束

- 业务工具不暴露任意阶段执行参数，阶段顺序由服务端状态机校验。
- 没有人工审批凭证，`sdr_continue_after_approval` 必须失败；审批凭证绑定草稿哈希，草稿被修改后自动失效。
- 没有 `send_email` 或通用 `send` 工具；默认 connector 的 `send()` 始终返回 `blocked-dry-run`。
- 客户发现时按 canonical domain、邮箱、电话和市场+标准化公司名去重；相同活动版本创建任务幂等复用。
- 每个工具动作写入带时间、任务 ID、阶段和结果摘要的审计事件，`sdr_audit_log` 可回放。

## 与原 ai-sdr 的关系

- 原 `app/` Python 项目完整保留，FastAPI、飞书机器人、Pydantic AI、RAG 和旧 MCP 入口仍可独立运行。
- `packages/dsh-sdr/` 是新的 DSH 原生适配和 Node 业务内核，不删除或覆盖原 Python 代码。
- `export_skills/`（如存在）是历史技能导出物，不是 bundle 的运行时依赖。

## 本地验证

```powershell
npm.cmd test --prefix "E:\ai-sdr\packages\dsh-sdr"
node "E:\ai-sdr\scripts\demo_dsh_sdr.mjs"
```

本包和原项目按 MIT 许可证发布，不包含 `.env`、真实客户数据或 API key。
