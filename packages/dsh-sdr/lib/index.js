import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const PACKAGE_NAME = "dsh-sdr";
const VERSION = "0.1.0";
const DEFAULT_CONTROL_URL = "http://127.0.0.1:8765";
const SOURCE_PRESET = fileURLToPath(new URL("../presets/sdr/", import.meta.url));

function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), ".dsh");
}

function targetPreset(presetId = "sdr") {
  return join(dshHome(), ".agent-presets", presetId);
}

async function readManagedMarker(path) {
  try {
    return JSON.parse(await readFile(join(path, ".dsh-sdr-managed.json"), "utf8"));
  } catch {
    return undefined;
  }
}

async function installManagedPreset() {
  const destination = targetPreset();
  const existing = await readManagedMarker(destination);
  let destinationExists = false;
  try {
    await stat(destination);
    destinationExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (destinationExists && (!existing || existing.package !== PACKAGE_NAME)) {
    throw new Error(`dsh-sdr: refusing to overwrite an unmanaged preset at ${destination}`);
  }
  try {
    await mkdir(destination, { recursive: true });
    await copyFile(join(SOURCE_PRESET, "agent.cordis.yml"), join(destination, "agent.cordis.yml"));
    await copyFile(join(SOURCE_PRESET, "preset.yml"), join(destination, "preset.yml"));
    await writeFile(
      join(destination, ".dsh-sdr-managed.json"),
      `${JSON.stringify({ managedBy: PACKAGE_NAME, package: PACKAGE_NAME, version: VERSION }, null, 2)}\n`,
      "utf8",
    );
    return destination;
  } catch (error) {
    throw new Error(`dsh-sdr: cannot install managed preset at ${destination}: ${String(error)}`, { cause: error });
  }
}

async function jsonResponse(response) {
  const body = await response.text();
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error(`dsh-sdr control server returned non-JSON (${response.status})`);
  }
  if (!response.ok || value.error) throw new Error(value.error || `dsh-sdr control server returned ${response.status}`);
  return value;
}

async function controlFetch(url, init, signal) {
  const response = await fetch(url, { ...init, signal });
  return jsonResponse(response);
}

function output() {
  return {
    schema: { type: "object", additionalProperties: true },
    render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
  };
}

function registerNativeGate(ctx, config = {}) {
  const controlUrl = config.controlUrl || DEFAULT_CONTROL_URL;
  const disposeGuard = ctx.tools.guard((execution) => {
    const name = String(execution.name || "").toLowerCase();
    if (name.includes("approve") || name.includes("send_email") || name.includes("send-email")) {
      return "SDR 审批和发送只能由原生人工审批门控完成；模型不能直接批准或发送邮件。";
    }
    return undefined;
  });

  const disposeReview = ctx.tools.register({
    name: "sdr_review_drafts",
    description: "在 SDR 人工审批卡点展示开发信草稿，并等待人类选择要批准的草稿。未获人类选择时任务保持暂停。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        task_id: { type: "string", description: "待审批的 SDR task_id。" },
      },
      required: ["task_id"],
    },
    output: output(),
    async execute(args, exec) {
      const pending = await controlFetch(
        `${controlUrl}/control/pending?task_id=${encodeURIComponent(args.task_id)}`,
        undefined,
        exec.signal,
      );
      const drafts = pending.drafts || [];
      if (drafts.length === 0) return { task_id: args.task_id, approved: [], pending: [] };
      const options = drafts.map((draft) => ({
        label: draft.email_id,
        description: `${draft.company || "客户"}: ${draft.subject || "开发信草稿"}`,
      }));
      const detail = drafts.map((draft) => `【${draft.email_id}】${draft.company || ""}\n${draft.subject || ""}\n${draft.body || ""}`).join("\n\n");
      const answer = await ctx.userQuestions.ask({
        questions: [{
          id: "drafts",
          header: "SDR 开发信审批",
          question: "选择允许进入下一阶段的开发信；未选择的草稿会继续保持待审批。",
          detail,
          options,
          multiSelect: true,
        }],
        signal: exec.signal,
      });
      const selected = new Set(answer.answers?.find((item) => item.id === "drafts")?.selected || []);
      const approved = [];
      for (const draft of drafts) {
        if (!selected.has(draft.email_id)) continue;
        approved.push(await controlFetch(`${controlUrl}/control/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task_id: args.task_id,
            email_id: draft.email_id,
            draft_hash: draft.draft_hash,
            approver: "dsh-user",
            source: "dsh-native-gate",
          }),
        }, exec.signal));
      }
      return {
        task_id: args.task_id,
        approved: approved.map((item) => item.result?.email_id).filter(Boolean),
        pending: drafts.filter((draft) => !selected.has(draft.email_id)).map((draft) => draft.email_id),
        requires_all_before_advance: true,
      };
    },
  });

  const disposeAudit = ctx.tools.register({
    name: "sdr_audit_log",
    description: "读取 SDR 任务的完整工具调用审计日志，用于回放和结案核验。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        task_id: { type: "string", description: "SDR task_id。" },
      },
      required: ["task_id"],
    },
    output: output(),
    async execute(args, exec) {
      return controlFetch(`${controlUrl}/control/audit?task_id=${encodeURIComponent(args.task_id)}`, undefined, exec.signal);
    },
  });

  return () => {
    disposeReview();
    disposeAudit();
    disposeGuard();
  };
}

export async function apply(ctx, config = {}) {
  if (config.role === "installer") {
    await installManagedPreset();
    return;
  }
  if (config.role === "agent") return registerNativeGate(ctx, config);
}

export { installManagedPreset, targetPreset };
