# DeepSeek Harness SDR Plugin (`dsh-sdr`)

面向 DeepSeek Harness `0.1.0-rc.6` 的外贸获客 SDR 数字员工插件。

`dsh-sdr` 将外贸获客 SOP、客户去重、RAG 知识库、人工审批和审计能力封装为可安装的 DeepSeek Harness bundle。安装后，DSH Web 的模式菜单会出现「SDR 数字员工」，可以直接派单并恢复任务。

> English summary: An installable DeepSeek Harness plugin for a controllable, auditable foreign-trade SDR digital employee. It runs a nine-stage sales SOP with persistent knowledge retrieval, structural human approval, lead deduplication, and dry-run connectors.

## 能做什么

- 按服务端状态机执行 9 阶段外贸获客 SOP：任务解析、客户发现、公司背调、评分、开发信、人工审批、跟进计划、报价素材、结案。
- 通过持久化知识库检索产品、品牌、认证、市场规则和报价政策，并在草稿和结案报告中保留来源版本引用。
- 以 canonical domain、邮箱、电话和标准化公司名去重，避免重复开发同一客户。
- 在人工批准前结构性阻断流程；草稿内容变化后，原审批凭证自动失效。
- 记录工具调用、阶段变化、审批和知识更新，支持审计回放。
- Email、WhatsApp、CRM 保持 connector 接口；无凭证时全部 dry-run，不发送真实消息。

## 安装

环境要求：

- DeepSeek Harness `0.1.0-rc.6`
- Node.js `20+`

从 GitHub 获取后安装：

```powershell
git clone https://github.com/Xuxchloris/deepseek-harness-sdr-plugin.git
cd deepseek-harness-sdr-plugin
dsh plugin --profile web add ".\packages\dsh-sdr"
dsh web
```

本地开发目录也可以直接安装：

```powershell
dsh plugin --profile web add "E:\ai-sdr\packages\dsh-sdr"
```

重启 Web 后新建会话，在模式菜单选择「SDR 数字员工」。如果默认端口被占用，可以使用：

```powershell
dsh web --port 3081
```

插件是 DSH 原生 Node bundle，不需要启动 Python MCP 服务，也不占用固定业务端口。

## 快速演示

在 SDR 模式中派单：

```text
开发 3 个美国户外用品客户
```

Agent 会逐阶段调用原生 SDR 工具。到达第 6 阶段时，界面展示开发信草稿并等待人工选择；未全部批准时不能进入跟进、报价或结案阶段。

也可以在没有 DSH Web 的情况下运行离线演示：

```powershell
npm.cmd test --prefix "E:\ai-sdr\packages\dsh-sdr"
node "E:\ai-sdr\scripts\demo_dsh_sdr.mjs"
```

## 架构

```text
DeepSeek Harness Web / SDR preset
                |
                | Cordis native tools
                v
        dsh-sdr Node runtime
                |
    +-----------+------------+----------------+
    |           |            |                |
  SOP 状态机  客户主数据   Hybrid RAG       审计日志
              + 去重       + 引用追踪       + 回放
    |           |            |                |
  审批哈希门控  ConnectorRegistry       KnowledgeRepository
                              |          +-- JSON adapter (本地)
                              |          +-- PostgreSQL/pgvector adapter
                              +-- Email / WhatsApp / CRM
```

DSH 负责 Agent loop、工具调用和人机交互；`dsh-sdr` 负责业务状态、工具权限和安全约束。模型不能指定任意阶段，也没有通用 `send` 工具可以绕过审批。

## 持久化知识与 RAG

插件采用分层记忆：

```text
DSH 会话记忆    当前对话和短期上下文
SDR 任务状态    阶段、客户、草稿、审批、结案
企业知识库     产品、品牌、认证、政策、案例、市场资料
审计/来源       版本、更新时间、引用和变更记录
```

默认本地 adapter 使用原子 JSON 文件，支持文档分块、BM25 风格全文召回、来源版本和 citation。`HybridRagRetriever` 可以注入 embedding provider 和 reranker，实现混合召回；`PostgresKnowledgeRepository` 提供 PostgreSQL 全文检索与 pgvector 生产适配。默认安装不依赖外部数据库或模型服务。

知识库评测工具 `sdr_knowledge_evaluate` 返回 Recall@K 和 MRR，建议将人工标注查询集纳入上线前回归测试。没有命中时，Agent 必须明确说明资料不足，不能把模型猜测当成企业事实。

如需让 Agent 沉淀经用户确认的新知识，部署前开启：

```powershell
$env:DSH_SDR_AGENT_KNOWLEDGE = '1'
```

密码、API key、token 和私钥不会进入知识库、工具参数或审计日志。

## 审批与外部连接

邮件流程是结构性门控：

```text
生成草稿 -> 草稿哈希 -> 人工选择 -> 全部批准 -> 后续 SOP
```

当前内置 connector 全部是 dry-run。`DSH_SDR_AGENT_LIVE_CONFIG=1` 只允许保存 live 配置，不会凭空启用真实发送；生产环境还需要部署方注册真实 Email/WhatsApp/CRM connector，并继续使用同一个审批门控。

## 当前验收状态

- DSH `0.1.0-rc.6` 本地安装和模式加载：已验证
- 9 阶段 SOP 闭环：已验证
- 人工审批和草稿哈希校验：已验证
- 客户跨活动去重和幂等：已验证
- 审计日志和结构化结案报告：已验证
- 默认 dry-run：已验证
- 混合 RAG 接口、来源引用、Recall@K/MRR：已验证
- 真实邮件、WhatsApp、CRM 外发：尚未启用，需部署方提供 connector 和凭证

## 项目结构

```text
packages/dsh-sdr/       DeepSeek Harness 插件 bundle（主要交付物）
  lib/domain.js         SDR 状态机、审批、去重、知识服务
  lib/rag.js            本地 RAG、混合召回、reranker、评测
  lib/postgres-rag.js   PostgreSQL/pgvector adapter
  lib/index.js          DSH native tool 注册入口
  presets/sdr/          「SDR 数字员工」persona 和 preset
app/                    原 ai-sdr Python 业务代码，完整保留
scripts/                离线演示脚本
docs/                   迁移方案、验收记录和设计说明
```

## 演进背景

项目最初是 Python 实现的外贸获客 SOP，随后加入 Agent loop、工具门控和 RAG；本版本进一步将稳定的业务约束迁移为 DeepSeek Harness 原生插件，让 DSH 负责 Agent 交互、而 SDR 内核负责可恢复流程、知识和安全边界。原 `app/` Python 路径继续保留，不是插件运行时依赖；`packages/dsh-sdr/` 是当前面向 DSH 的正式交付物。

## 许可证

本项目使用 MIT License。仓库不包含 `.env`、真实客户数据或 API key；示例数据均为合成数据。
