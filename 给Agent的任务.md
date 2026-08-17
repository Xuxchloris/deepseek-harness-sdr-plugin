# 给 Agent 的任务书：把 ai-sdr 改造成 DeepSeek Harness 插件

## 角色
你是一名资深 Agent 架构工程师，熟悉 DeepSeek Harness（DSH）和 Cordis 插件体系。

## 背景
我本地有一个 Python 项目 `E:\ai-sdr\`，是外贸获客 AI 员工（SDR Agent）。
它已经实现：
- 9 阶段 SOP 状态机（app/state.py）
- Pydantic AI Agent 循环（app/agent/agent.py）
- 审批门控，邮件未批准绝不发送（app/tools/gates.py）
- 合规护栏（app/guardrails.py）
- RAG（bge-m3 + FAISS，app/rag/retriever.py）
- MCP 工具加载器（app/tools/mcp.py）
- FastAPI 接口和飞书机器人（app/api、app/feishu）

DeepSeek Harness 官方仓库：
https://github.com/deepseek-ai/deepseek-harness

## 目标
把 ai-sdr 改造成一个可安装、可选择的 DeepSeek Harness 第三方插件 `dsh-sdr`：
- 在 DSH 的模式菜单中出现「SDR 数字员工」模式
- 该模式下 Agent 按外贸 SOP 工作
- 工具可插拔，审批门控保持硬约束

## 第一件事：先调研，不要写代码
先读这些内容：
1. `E:\ai-sdr\README.md`、`E:\ai-sdr\项目计划书.md`、`E:\ai-sdr\项目交接.md`
2. DeepSeek Harness 官方文档：
   - https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/
   - https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool
   - https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish
3. 参考插件：https://github.com/amlyczz/dsh-lark-link

调研后先给我一份《迁移方案》，包含：
- 推荐架构（我倾向 Python 业务逻辑保留，通过 MCP server 暴露给 DSH）
- 插件目录结构
- 哪些现有代码保留、哪些重写、哪些删除
- 审批门控如何在 DSH 里实现
- 风险和 API 兼容性问题

方案经我确认后，再开始写代码。不要擅自重构 Python 业务逻辑。

## 目标架构（供你方案参考，不要照抄细节）
1. `dsh-sdr` 作为 DSH bundle，包含：
   - SDR 系统提示词 / SOP 插件
   - 工具注册插件（9 阶段工具）
   - 审批门控插件
   - 审计日志插件
2. 现有 Python 业务逻辑尽量保留，通过 MCP server 暴露：
   - RAG 检索
   - 客户发现 / 背调 / 评分 / 报价素材
3. 邮件发送保持红线：草稿 → 人工审批 → 才允许发送；没有真实邮件服务时一律 draft-only。

## 硬性要求
1. 必须保持可安装：最终能用 `dsh plugin --profile web add ...` 安装。
2. 必须保持现有 Python 代码可用，禁止直接删除后重写。
3. 审批门控必须是结构性的，不能只靠 prompt 提示“请不要发邮件”。
4. 所有外部服务默认 dry-run / 合成数据，无凭证也能完整演示。
5. 不提交 .env、真实客户数据、API key。
6. 改动遵循 MIT 许可证要求，README 写清楚和原 ai-sdr、export_skills 的关系。
7. 每一步提交单独 commit，提交信息说清楚为什么改。

## 交付物
1. `dsh-sdr` 插件源码
2. `README.md`：安装、使用、架构图、当前完成度
3. 端到端演示脚本或录屏步骤
4. 验收清单自测结果

## 验收标准
- [ ] `dsh plugin --profile web add <你的插件>` 安装成功
- [ ] 重启 `dsh web` 后，模式菜单出现「SDR 数字员工」
- [ ] 在 Web UI 里派单「开发 3 个美国户外用品客户」，Agent 能按 9 阶段推进
- [ ] 到达审批卡点，不批准无法继续
- [ ] 批准后能继续到结案，并输出结构化结案报告
- [ ] 全程工具调用有审计日志，可回放
- [ ] 无真实凭证时，所有外部工具走 dry-run，不报错、不发送
