import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConnectorRegistry, DryRunConnector, JsonStore, SdrService } from "../lib/domain.js";

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
  assert.equal(persisted.version, 2);
});

test("connector registry 支持后续 WhatsApp/CRM 实现替换", async () => {
  const registry = new ConnectorRegistry([]);
  const custom = new DryRunConnector("whatsapp");
  registry.register(custom);
  assert.equal(registry.get("whatsapp"), custom);
  assert.throws(() => registry.get("email"), /未注册/);
});
