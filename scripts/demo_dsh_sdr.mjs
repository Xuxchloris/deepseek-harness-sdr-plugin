import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorRegistry, JsonStore, SdrService } from "../packages/dsh-sdr/lib/domain.js";

const directory = await mkdtemp(join(tmpdir(), "dsh-sdr-demo-"));
const sdr = new SdrService({ store: new JsonStore(join(directory, "state.json")), connectors: new ConnectorRegistry() });
const created = await sdr.createTask({ task: "开发 3 个美国户外用品客户", campaignVersion: "demo" });
console.log(`created ${created.task_id}: ${created.stage}`);

for (let index = 0; index < 5; index += 1) {
  const step = await sdr.nextStep(created.task_id);
  console.log(`step ${index + 1}: ${step.task.stage}`);
}

const drafts = await sdr.getDrafts(created.task_id);
console.log(`approval gate: ${drafts.pending.length} pending`);
try {
  await sdr.continueAfterApproval(created.task_id);
} catch (error) {
  console.log(`before approval: ${error.message}`);
}

await sdr.reviewDrafts(created.task_id, drafts.drafts.map((draft) => draft.email_id), "demo-user");
await sdr.continueAfterApproval(created.task_id);
for (let index = 0; index < 3; index += 1) await sdr.nextStep(created.task_id);

console.log("report", JSON.stringify((await sdr.getReport(created.task_id)).report, null, 2));
console.log(`audit entries: ${(await sdr.auditLog(created.task_id)).count}`);
