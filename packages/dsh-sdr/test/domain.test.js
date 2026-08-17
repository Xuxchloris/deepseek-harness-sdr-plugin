import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConnectorRegistry, DryRunConnector, JsonStore, KnowledgeBase, SdrService } from "../lib/domain.js";
import { HybridRagRetriever } from "../lib/rag.js";

async function service() {
  const directory = await mkdtemp(join(tmpdir(), "dsh-sdr-test-"));
  const store = new JsonStore(join(directory, "state.json"));
  return { service: new SdrService({ store }), store };
}

async function createAtApproval(sdr) {
  const created = await sdr.createTask({ task: "开发 3 个美国户外用品客户", campaignVersion: `test-${Date.now()}-${Math.random()}` });
  for (let index = 0; index < 5; index += 1) await sdr.nextStep(created.task_id);
  return { taskId: created.task_id, state: await sdr.getDrafts(created.task_id) };
}

test("九阶段流程由服务端推进，审批前结构性阻断", async () => {
  const { service: sdr } = await service();
  const { taskId, state } = await createAtApproval(sdr);
  assert.equal(state.stage, "human_approval");
  assert.equal(state.drafts.length, 3);
  await assert.rejects(() => sdr.continueAfterApproval(taskId), /未获批准/);

  const approved = await sdr.reviewDrafts(taskId, state.drafts.map((draft) => draft.email_id), "test-reviewer");
  assert.deepEqual(approved.pending, []);
  assert.equal((await sdr.continueAfterApproval(taskId)).task.stage, "follow_up_plan");
  await sdr.nextStep(taskId);
  await sdr.nextStep(taskId);
  const closed = await sdr.nextStep(taskId);
  assert.equal(closed.task.stage, "close");
  assert.equal((await sdr.getReport(taskId)).complete, true);
  assert.ok((await sdr.auditLog(taskId)).count >= 8);
});

test("客户主数据跨活动去重，并对相同活动请求幂等复用", async () => {
  const { service: sdr } = await service();
  const first = await sdr.createTask({ task: "开发 3 个美国户外用品客户", campaignVersion: "dedupe-a" });
  const same = await sdr.createTask({ task: "开发 3 个美国户外用品客户", campaignVersion: "dedupe-a" });
  assert.equal(first.task_id, same.task_id);
  await sdr.nextStep(first.task_id);
  const firstDiscovery = await sdr.nextStep(first.task_id);
  const second = await sdr.createTask({ task: "寻找 3 家美国户外用品经销商", campaignVersion: "dedupe-b" });
  await sdr.nextStep(second.task_id);
  const secondDiscovery = await sdr.nextStep(second.task_id);
  const firstIds = new Set(firstDiscovery.result.prospects.map((lead) => lead.canonical_lead_id));
  const secondIds = secondDiscovery.result.prospects.map((lead) => lead.canonical_lead_id);
  assert.equal(secondIds.filter((id) => firstIds.has(id)).length, 0);
});

test("审批绑定草稿哈希，默认 connector 全部 dry-run", async () => {
  const { service: sdr, store } = await service();
  const { taskId, state } = await createAtApproval(sdr);
  await store.mutate((data) => {
    data.tasks[taskId].drafts[0].subject = "tampered";
  });
  await assert.rejects(() => sdr.reviewDrafts(taskId, [state.drafts[0].email_id]), /哈希不匹配/);
  const status = await sdr.connectorStatus();
  assert.deepEqual(status.connectors.map((connector) => connector.channel), ["email", "whatsapp", "crm"]);
  assert.equal(status.connectors.every((connector) => connector.dry_run), true);
  const connector = new DryRunConnector("whatsapp");
  assert.equal((await connector.send({})).sent, false);
});

test("状态文件使用原子 JSON 持久化", async () => {
  const { service: sdr, store } = await service();
  await sdr.createTask({ task: "开发 1 个美国客户", campaignVersion: "persist" });
  const persisted = JSON.parse(await readFile(store.path, "utf8"));
  assert.equal(Object.keys(persisted.tasks).length, 1);
  assert.equal(persisted.version, 3);
});

test("connector registry 支持后续 WhatsApp/CRM 实现替换", async () => {
  const registry = new ConnectorRegistry([]);
  const custom = new DryRunConnector("whatsapp");
  registry.register(custom);
  assert.equal(registry.get("whatsapp"), custom);
  assert.throws(() => registry.get("email"), /未注册/);
});

test("Agent 配置需要部署开关，并保留部署基线且拒绝敏感值", async () => {
  const { service: blocked } = await service();
  await assert.rejects(() => blocked.configureConnector({ channel: "email", settings: { host: "smtp.example" } }), /未放行/);

  const { store } = await service();
  const sdr = new SdrService({
    store,
    deploymentConfig: { email: { host: "smtp.baseline.example", port: 587, password_ref: "DSH_SMTP_PASSWORD" } },
    allowAgentConfig: true,
  });
  const configured = await sdr.configureConnector({ channel: "email", settings: { host: "smtp.runtime.example", secure: true, from: "sdr@example.com" } });
  assert.equal(configured.deployment_config_preserved, true);
  const status = await sdr.connectorStatus();
  const email = status.connectors.find((connector) => connector.channel === "email");
  assert.equal(email.deployment_config.host, "smtp.baseline.example");
  assert.equal(email.runtime_override.host, "smtp.runtime.example");
  assert.equal(email.effective_config.port, 587);
  assert.equal(email.deployment_config.password_ref, "DSH_SMTP_PASSWORD");
  await assert.rejects(() => sdr.configureConnector({ channel: "email", settings: { password: "plain-secret" } }), /敏感字段/);
});

test("企业知识跨服务实例持久化，并自动注入开发信引用", async () => {
  const { store } = await service();
  const writer = new SdrService({ store, allowAgentKnowledge: true });
  const entry = await writer.knowledgeUpsert({ type: "product", title: "户外用品核心卖点", content: "我们的户外用品支持 BPA-free 材料、可定制包装，MOQ 为 500 件。", tags: ["户外用品", "MOQ"], source: "user-guided-catalogue" });
  const reloaded = new SdrService({ store: new JsonStore(store.path) });
  const searched = await reloaded.knowledgeSearch("户外用品 MOQ");
  assert.equal(searched.entries[0].knowledge_id, entry.knowledge_id);

  const created = await reloaded.createTask({ task: "开发 1 个美国户外用品客户", campaignVersion: "knowledge-flow" });
  const parsed = await reloaded.nextStep(created.task_id);
  assert.equal(parsed.result.knowledge[0].knowledge_id, entry.knowledge_id);
  for (let index = 0; index < 4; index += 1) await reloaded.nextStep(created.task_id);
  const drafts = await reloaded.getDrafts(created.task_id);
  assert.match(drafts.drafts[0].body, /BPA-free/);
  assert.ok(drafts.drafts[0].citations.some((citation) => citation.includes(entry.knowledge_id)));
});

test("混合 RAG 支持语义召回、来源版本引用和 Recall@K/MRR 评测", async () => {
  const { store } = await service();
  const embedder = {
    async embed(text) {
      return /防水|rain|protection/i.test(text) ? [1, 0] : [0, 1];
    },
  };
  const knowledge = new KnowledgeBase({ store, retriever: new HybridRagRetriever({ embedder }) });
  const tent = await knowledge.upsert({ type: "product", title: "防水户外帐篷", content: "适合雨季露营，支持可定制包装。", source: "catalogue-v1" });
  await knowledge.upsert({ type: "product", title: "保温水壶", content: "适合日常户外饮水。", source: "catalogue-v1" });

  const hits = await knowledge.search("rain protection", { limit: 1 });
  assert.equal(hits[0].knowledge_id, tent.knowledge_id);
  assert.equal(hits[0].citation, `${tent.knowledge_id}@v1 (catalogue-v1)`);
  assert.equal(hits[0].retrieval.semantic, 1);
  assert.equal(hits[0].retrieval.matched_chunks.length, 0);

  const metrics = await knowledge.evaluate({ queries: [{ text: "rain protection", relevant_knowledge_ids: [tent.knowledge_id] }], k: 1 });
  assert.equal(metrics.recall_at_k, 1);
  assert.equal(metrics.mrr, 1);
});
