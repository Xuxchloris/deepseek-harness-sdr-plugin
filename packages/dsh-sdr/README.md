# dsh-sdr

`dsh-sdr` 是面向 DeepSeek Harness `0.1.0-rc.6` 的 SDR 数字员工 bundle。当前版本把 9 阶段业务编排、审批门控、客户去重和审计放在 Node.js 原生运行时中，DSH 只负责 Agent loop、工具调用和人机交互。不需要 Python MCP 服务，也不占用 `8765` 端口。

## 安装和重载

从 npm 安装：

```powershell
dsh plugin --profile web add @xuxchloris/dsh-sdr
dsh web
```

从 GitHub 源码安装：

```powershell
dsh plugin --profile web add ".\packages\dsh-sdr"
dsh web
```

如果插件已经安装过，先再次执行 `add` 让 Harness 重新读取本地 bundle，然后重启 `dsh web`。新建会话时，在模式菜单选择「SDR 数字员工」。rc.6 采用受管 preset 安装器，preset 会写入：

```text
$DSH_HOME/.agent-presets/sdr
```

Windows 未设置 `DSH_HOME` 时，默认是 `%USERPROFILE%\\.dsh\\.agent-presets\\sdr`。安装器不会覆盖没有 `.dsh-sdr-managed.json` 标记的同名 preset。

## 维护者发布

本包通过仓库根目录的 `.github/workflows/npm-publish.yml` 发布。工作流只接受 `dsh-sdr-v*` 标签，使用 GitHub Actions OIDC，不需要 npm token；发布前会运行 `npm test`。

首次发布尚不存在的包时，npm 尚未生成包设置页，需用一次短期 granular token 完成 `0.2.0` 首发，并在发布后立即撤销。随后在 npm 包设置的 **Trusted Publisher** 中填写：

```text
Provider: GitHub Actions
User: Xuxchloris
Repository: deepseek-harness-sdr-plugin
Workflow filename: npm-publish.yml
Allowed action: npm publish
```

绑定完成后，只需递增版本并推送标签：

```powershell
git tag dsh-sdr-v0.2.1
git push origin dsh-sdr-v0.2.1
```

GitHub Actions 使用 Node 24、`id-token: write` 和 npm Trusted Publishing。它不会读取或写入 npm token；公开仓库的发布会自动生成 provenance。Trusted Publisher 验证成功后，建议在 npm 包设置中启用「Require two-factor authentication and disallow tokens」。

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
        +-- Hybrid RAG (BM25 + optional embeddings + reranker)
        +-- ConnectorRegistry
              +-- email      (dry-run)
              +-- whatsapp   (dry-run placeholder)
              +-- crm        (dry-run placeholder)
```

默认状态文件为 `%USERPROFILE%\\.dsh\\.dsh-sdr\\state.json`，也可以设置 `DSH_SDR_DATA_FILE` 指定路径。状态文件只保存本地合成演示数据，不需要凭证。未来可以把 `JsonStore` 换成 SQLite/PostgreSQL adapter，把 `ConnectorRegistry` 中的 dry-run connector 换成 SMTP/SES、WhatsApp Business API、HubSpot、Salesforce 或飞书实现，SOP 和审批工具接口不变。

## 记忆架构

插件采用四层记忆，不把聊天记录直接当成企业事实：

```text
DSH 会话记忆       当前对话和短期上下文
SDR 任务状态       阶段、客户、草稿、审批、结案
KnowledgeBase      产品、品牌、认证、政策、案例、市场资料
审计/来源           版本、来源、更新时间、引用关系
```

`KnowledgeBase` 当前使用原子 JSON adapter，支持跨任务保存、分块、BM25 风格全文召回、可注入 embedding provider 的语义召回、混合排序、确定性 reranker，以及来源/版本/citation。Agent 自动在任务解析、背调、评分、开发信、报价和结案阶段检索已批准知识，并把 `knowledge_id@version` 写入草稿引用和结案报告。

默认安装不需要外部服务：没有 embedding provider 时仍可离线运行全文 RAG。生产部署可以使用 `lib/postgres-rag.js` 中的 `PostgresKnowledgeRepository`，通过注入现有 `pg` pool 替换存储，并配置 PostgreSQL 全文索引、`pgvector` 和 embedding/reranker。RAG 评测工具 `sdr_knowledge_evaluate` 返回 Recall@K 和 MRR，建议用一组人工标注查询作为上线回归集。

生产侧注入方式保持业务接口不变：

```js
const knowledge = new PostgresKnowledgeRepository({ pool, embedder, reranker });
const sdr = new SdrService({ store, knowledge });
await knowledge.ensureSchema();
```

`pg`、embedding 服务和数据库凭证由部署环境提供，不会进入插件参数或审计日志。

如需让 Agent 把你确认过的产品、品牌或报价规则沉淀下来，部署时开启：

```powershell
$env:DSH_SDR_AGENT_KNOWLEDGE = '1'
```

然后 Agent 可调用 `sdr_knowledge_upsert`。每条记录必须有类型、来源和内容，版本更新会写入审计。没有开关时知识库仍可检索，但 Agent 不能写入。Letta 不作为 DSH 的第二个 Agent loop；如未来需要，可只实现一个可选的 episodic-memory adapter，不让它修改产品事实或审批状态。

## 部署配置与 Agent 覆盖

部署前的非敏感 connector 基线可以通过 `DSH_SDR_DEPLOYMENT_CONFIG_JSON` 注入，例如：

```powershell
$env:DSH_SDR_DEPLOYMENT_CONFIG_JSON = '{"email":{"provider":"smtp","host":"smtp.example.com","port":587,"secure":true,"from":"sdr@example.com","password_ref":"DSH_SMTP_PASSWORD"}}'
```

如需让 Agent 在部署过程中补充 host、port、provider、发件人或凭证引用名，再显式开启：

```powershell
$env:DSH_SDR_AGENT_CONFIG = '1'
```

开启后 Agent 可以调用 `sdr_configure_connector` 写入运行时覆盖；部署基线不会被覆盖，可以通过 `sdr_connector_status` 同时查看基线、覆盖和合并结果。密码、API key、token 等敏感值不能通过工具写入，Agent 只能填写引用名。当前内置 connector 仍然是 dry-run；`DSH_SDR_AGENT_LIVE_CONFIG=1` 只代表允许保存 `mode=live` 配置，不会凭空启用真实发送。

## 结构性安全约束

- 业务工具不暴露任意阶段执行参数，阶段顺序由服务端状态机校验。
- 没有人工审批凭证，`sdr_continue_after_approval` 必须失败；审批凭证绑定草稿哈希，草稿被修改后自动失效。
- 没有 `send_email` 或通用 `send` 工具；默认 connector 的 `send()` 始终返回 `blocked-dry-run`。
- Agent 配置默认关闭；打开 `DSH_SDR_AGENT_CONFIG=1` 后也只能写白名单覆盖，部署前基线和敏感凭证仍由部署环境掌控。
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
