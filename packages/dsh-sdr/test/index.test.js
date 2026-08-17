import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { apply } from "../lib/index.js";

test("DSH native tools all publish object JSON schemas", async () => {
  const registered = [];
  const directory = await mkdtemp(join(tmpdir(), "dsh-sdr-index-"));
  const context = {
    tools: {
      register(definition) {
        registered.push(definition);
        return () => undefined;
      },
      guard() {
        return () => undefined;
      },
    },
    userQuestions: { ask: async () => ({ answers: [] }) },
  };
  const dispose = await apply(context, { role: "agent", dataFile: join(directory, "state.json") });
  assert.deepEqual(registered.map((item) => item.name), [
    "sdr_create_task",
    "sdr_next_step",
    "sdr_review_drafts",
    "sdr_continue_after_approval",
    "sdr_get_task",
    "sdr_get_report",
    "sdr_audit_log",
    "sdr_connector_status",
  ]);
  for (const item of registered) {
    assert.equal(item.parameters.type, "object", item.name);
    assert.equal(item.output.schema.type, "object", item.name);
  }
  dispose();
});
