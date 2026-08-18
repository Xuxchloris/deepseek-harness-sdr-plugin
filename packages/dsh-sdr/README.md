# `@xuxchloris/dsh-sdr`

[![npm version](https://img.shields.io/npm/v/@xuxchloris/dsh-sdr?logo=npm)](https://www.npmjs.com/package/@xuxchloris/dsh-sdr)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/Xuxchloris/deepseek-harness-sdr-plugin/blob/main/LICENSE)

DeepSeek Harness `0.1.0-rc.6` 的 SDR 数字员工插件。它使用 Node.js 原生运行时提供九阶段外贸获客 SOP、持久化知识检索、客户去重、结构性人工审批和审计日志。

它不是通用群发器：Email、WhatsApp、CRM 默认都是 dry-run，没有部署方显式配置时不会发送外部消息；也不需要启动 Python MCP 服务或占用固定端口。

完整产品说明、架构图和验收标准见[仓库根目录 README](https://github.com/Xuxchloris/deepseek-harness-sdr-plugin#readme)。

## 安装

环境要求：DeepSeek Harness `0.1.0-rc.6`、Node.js `20+`。

```powershell
dsh plugin --profile web add @xuxchloris/dsh-sdr
dsh web
```

重启 Web 后新建会话，在模式菜单选择「SDR 数字员工」。源码安装：

```powershell
git clone https://github.com/Xuxchloris/deepseek-harness-sdr-plugin.git
cd deepseek-harness-sdr-plugin
dsh plugin --profile web add ".\packages\dsh-sdr"
dsh web
```

rc.6 使用受管 preset 安装器，默认写入 `$DSH_HOME/.agent-presets/sdr`；Windows 未设置 `DSH_HOME` 时使用 `%USERPROFILE%\\.dsh\\.agent-presets\\sdr`。安装器拒绝覆盖没有 `dsh-sdr` 管理标记的同名 preset。

## 最小验收

在 SDR 模式中输入：

```text
开发 3 个美国户外用品客户
```

Agent 会调用 `sdr_create_task` 和 `sdr_next_step`，由服务端决定阶段顺序。第 6 阶段调用 `sdr_review_drafts` 展示草稿并等待人工选择；只有全部当前草稿哈希具有批准凭证时，`sdr_continue_after_approval` 才会放行。

没有 DSH Web 时，在源码仓库的 `packages/dsh-sdr` 目录下运行离线测试：

```powershell
npm.cmd test
node "..\..\scripts\demo_dsh_sdr.mjs"
```

若模式菜单没有出现，重新执行 `dsh plugin --profile web add ...`，重启 `dsh web` 并新建会话。若审批工具返回 `fetch failed`，检查当前会话是否支持 agent-owned 交互提问；任务会安全冻结，不会绕过审批继续执行。

## 数据与配置

默认任务状态保存在 `%USERPROFILE%\\.dsh\\.dsh-sdr\\state.json`，可用 `DSH_SDR_DATA_FILE` 指定其他路径。默认知识库是本地原子 JSON adapter；生产环境可以注入：

```js
const knowledge = new PostgresKnowledgeRepository({ pool, embedder, reranker });
const sdr = new SdrService({ store, knowledge });
await knowledge.ensureSchema();
```

知识库支持全文召回、可选 embedding、混合排序、reranker、来源版本以及 Recall@K/MRR 评测。数据库、embedding 服务和凭证由部署环境提供，不进入工具参数或审计日志。

让 Agent 写入用户确认过的企业知识：

```powershell
$env:DSH_SDR_AGENT_KNOWLEDGE = '1'
```

允许 Agent 在部署期间补充非敏感 connector 配置：

```powershell
$env:DSH_SDR_AGENT_CONFIG = '1'
```

Agent 只能填写白名单字段和凭证引用名，不能写入密码、token 或 API key 值。`DSH_SDR_AGENT_LIVE_CONFIG=1` 只允许保存 live 配置，不会自动启用真实发送。

## 工具契约

主要工具包括：`sdr_create_task`、`sdr_next_step`、`sdr_review_drafts`、`sdr_continue_after_approval`、`sdr_get_task`、`sdr_get_report`、`sdr_audit_log`、`sdr_knowledge_search`、`sdr_knowledge_upsert`、`sdr_knowledge_list`、`sdr_knowledge_evaluate`、`sdr_connector_status` 和 `sdr_configure_connector`。

没有 `send_email` 或通用 `send` 工具。默认 connector 的 `send()` 返回 `blocked-dry-run`，审批门控由服务端状态机和草稿哈希共同执行。

## 维护者发布

发布工作流位于仓库根目录 `.github/workflows/npm-publish.yml`，只响应 `dsh-sdr-v*` 标签，发布前运行 `npm test`，使用 GitHub Actions OIDC 和 npm Trusted Publishing，不需要长期 npm token。

```powershell
npm version patch
git tag dsh-sdr-v0.2.1
git push origin dsh-sdr-v0.2.1
```

## 许可证

MIT License。仓库不包含 `.env`、真实客户数据或 API key。
