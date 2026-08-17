import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { ConnectorRegistry, JsonStore, SdrService, defaultStorePath } from "./domain.js";

const PACKAGE_NAME = "dsh-sdr";
const VERSION = "0.2.0";
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
    await writeFile(join(destination, ".dsh-sdr-managed.json"), `${JSON.stringify({ managedBy: PACKAGE_NAME, package: PACKAGE_NAME, version: VERSION }, null, 2)}\n`, "utf8");
    return destination;
  } catch (error) {
    throw new Error(`dsh-sdr: cannot install managed preset at ${destination}: ${String(error)}`, { cause: error });
  }
}

const objectOutput = {
  schema: { type: "object", additionalProperties: true },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};

const schemas = {
  createTask: {
    type: "object",
    additionalProperties: false,
    properties: {
      task: { type: "string", description: "例如：开发 3 个美国户外用品客户" },
      market: { type: "string", description: "可选市场代码，如 US、EU、SEA、JP" },
      product: { type: "string", description: "可选产品名称" },
      campaign_version: { type: "string", description: "可选活动版本，用于幂等去重" },
    },
    required: ["task"],
  },
  taskId: {
    type: "object",
    additionalProperties: false,
    properties: { task_id: { type: "string", description: "SDR 任务 ID" } },
    required: ["task_id"],
  },
};

function registerTool(ctx, definition) {
  return ctx.tools.register({ ...definition, output: objectOutput });
}

function registerNativeSdr(ctx, config = {}) {
  const service = new SdrService({
    store: new JsonStore(config.dataFile || defaultStorePath()),
    connectors: new ConnectorRegistry(),
  });

  const disposers = [];
  disposers.push(registerTool(ctx, {
    name: "sdr_create_task",
    description: "创建一个可恢复的 SDR 任务。相同请求、市场、产品和活动版本会幂等复用，不会重复开发同一活动。",
    parameters: schemas.createTask,
    async execute(args) {
      try {
        return await service.createTask({ task: args.task, market: args.market, product: args.product, campaignVersion: args.campaign_version });
      } catch (error) {
        return { error: String(error.message || error) };
      }
    },
  }));

  disposers.push(registerTool(ctx, {
    name: "sdr_next_step",
    description: "执行当前任务的下一个 SOP 阶段。阶段由服务端状态机决定，模型不能指定或跳过阶段。到人工审批阶段会结构化阻断。",
    parameters: schemas.taskId,
    async execute(args) {
      try {
        return await service.nextStep(args.task_id);
      } catch (error) {
        return { error: String(error.message || error) };
      }
    },
  }));

  disposers.push(registerTool(ctx, {
    name: "sdr_review_drafts",
    description: "在人工审批卡点展示全部开发信草稿，并等待人类选择。此工具是唯一的审批入口，不向模型暴露 approve 或 send 工具。",
    parameters: schemas.taskId,
    async execute(args, exec) {
      try {
        const pending = await service.getDrafts(args.task_id);
        if (!pending.drafts.length) return pending;
        const options = pending.drafts.map((draft) => ({ label: draft.email_id, description: `${draft.company}: ${draft.subject}` }));
        const detail = pending.drafts.map((draft) => `【${draft.email_id}】${draft.company}\n${draft.subject}\n${draft.body}`).join("\n\n");
        const answer = await ctx.userQuestions.ask({
          questions: [{ id: "drafts", header: "SDR 开发信审批", question: "选择允许进入下一阶段的开发信；未选择的草稿会继续保持待审批。", detail, options, multiSelect: true }],
          signal: exec?.signal,
        });
        const selected = answer?.answers?.find((item) => item.id === "drafts")?.selected || [];
        return await service.reviewDrafts(args.task_id, selected, "dsh-user");
      } catch (error) {
        return { error: String(error.message || error) };
      }
    },
  }));

  disposers.push(registerTool(ctx, {
    name: "sdr_continue_after_approval",
    description: "审批卡点后的结构化放行。只有每一封草稿都有当前哈希绑定的人工批准凭证时，才允许进入跟进阶段。",
    parameters: schemas.taskId,
    async execute(args) {
      try {
        return await service.continueAfterApproval(args.task_id);
      } catch (error) {
        return { error: String(error.message || error) };
      }
    },
  }));

  disposers.push(registerTool(ctx, {
    name: "sdr_get_task",
    description: "读取 SDR 任务的真实持久化状态摘要。",
    parameters: schemas.taskId,
    async execute(args) {
      try {
        return await service.getTask(args.task_id);
      } catch (error) {
        return { error: String(error.message || error) };
      }
    },
  }));

  disposers.push(registerTool(ctx, {
    name: "sdr_get_report",
    description: "读取结构化结案报告；任务未到结案阶段时会明确返回 incomplete。",
    parameters: schemas.taskId,
    async execute(args) {
      try {
        return await service.getReport(args.task_id);
      } catch (error) {
        return { error: String(error.message || error) };
      }
    },
  }));

  disposers.push(registerTool(ctx, {
    name: "sdr_audit_log",
    description: "读取 SDR 任务的完整事件审计日志，用于回放和结案核验。",
    parameters: schemas.taskId,
    async execute(args) {
      try {
        return await service.auditLog(args.task_id);
      } catch (error) {
        return { error: String(error.message || error) };
      }
    },
  }));

  disposers.push(registerTool(ctx, {
    name: "sdr_connector_status",
    description: "查看 Email、WhatsApp、CRM connector 的注册状态；默认全部 dry-run，不会发送真实消息。",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      return service.connectorStatus();
    },
  }));

  const disposeGuard = ctx.tools.guard((execution) => {
    const name = String(execution.name || "").toLowerCase();
    if (name.includes("approve") || name.includes("send_email") || name.includes("send-email") || name === "send") {
      return "SDR 审批和发送只能由原生人工审批门控完成；模型不能直接批准或发送消息。";
    }
    return undefined;
  });
  disposers.push(disposeGuard);
  return () => disposers.splice(0).reverse().forEach((dispose) => dispose?.());
}

export async function apply(ctx, config = {}) {
  if (config.role === "installer") {
    await installManagedPreset();
    return;
  }
  if (config.role === "agent") return registerNativeSdr(ctx, config);
}

export { ConnectorRegistry, JsonStore, SdrService, defaultStorePath, installManagedPreset, targetPreset };
