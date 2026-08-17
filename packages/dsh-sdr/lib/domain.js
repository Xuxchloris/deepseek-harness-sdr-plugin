import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const STAGES = Object.freeze([
  "task_parse",
  "prospect_discovery",
  "company_research",
  "prospect_scoring",
  "email_draft",
  "human_approval",
  "follow_up_plan",
  "quotation_pack",
  "close",
]);

const STAGE_LABELS = Object.freeze({
  task_parse: "任务解析",
  prospect_discovery: "客户发现",
  company_research: "公司背调",
  prospect_scoring: "客户评分",
  email_draft: "开发信草稿",
  human_approval: "人工审批",
  follow_up_plan: "跟进计划",
  quotation_pack: "报价素材",
  close: "结案",
});

const SYNTHETIC_LEADS = [
  ["Northstar Outdoor Supply", "northstar-outdoor.example", "US"],
  ["Canyon Trail Outfitters", "canyon-trail.example", "US"],
  ["Harbor Peak Gear", "harbor-peak.example", "US"],
  ["Summit Field Co", "summit-field.example", "US"],
  ["Evergreen Camp Market", "evergreen-camp.example", "US"],
  ["Redwood Adventure Goods", "redwood-adventure.example", "US"],
  ["Blue Ridge Wholesale", "blue-ridge.example", "US"],
  ["Atlas Trek Distribution", "atlas-trek.example", "US"],
  ["Mistral Outdoor Trade", "mistral-outdoor.example", "EU"],
  ["Alpine Route Buyers", "alpine-route.example", "EU"],
  ["Pacific Field Imports", "pacific-field.example", "SEA"],
  ["Sakura Trail Partners", "sakura-trail.example", "JP"],
];

function syntheticCandidates(market) {
  const staticCandidates = SYNTHETIC_LEADS.filter(([, , candidateMarket]) => candidateMarket === market);
  const generated = Array.from({ length: 50 }, (_, index) => {
    const serial = String(index + 1).padStart(2, "0");
    const label = market === "US" ? "Outdoor Buyer" : market === "EU" ? "Alpine Trade Buyer" : market === "SEA" ? "Pacific Trade Buyer" : "Trail Trade Buyer";
    return [`Demo ${label} ${serial}`, `demo-${market.toLowerCase()}-${serial}.example`, market];
  });
  return [...staticCandidates, ...generated];
}

const DEFAULT_STATE = Object.freeze({ version: 2, tasks: {}, leads: {}, audit: [], runtime_config: {} });
const CONNECTOR_CHANNELS = new Set(["email", "whatsapp", "crm"]);
const CONNECTOR_SETTING_KEYS = new Set([
  "provider",
  "mode",
  "enabled",
  "from",
  "base_url",
  "host",
  "port",
  "secure",
  "phone_number_id",
  "tenant",
  "username_ref",
  "password_ref",
  "api_key_ref",
  "credential_ref",
]);
const SECRET_SETTING_PATTERN = /(password|secret|token|api[_-]?key|private[_-]?key|credential_value)/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeConnectorSettings(settings = {}) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("connector settings 必须是对象");
  const normalized = {};
  for (const [key, value] of Object.entries(settings)) {
    if (SECRET_SETTING_PATTERN.test(key) && !key.endsWith("_ref")) throw new Error(`禁止通过 Agent 写入敏感字段: ${key}`);
    if (!CONNECTOR_SETTING_KEYS.has(key)) throw new Error(`不允许的 connector 配置字段: ${key}`);
    if (typeof value === "string" && value.length > 512) throw new Error(`connector 配置字段过长: ${key}`);
    if (!["string", "number", "boolean"].includes(typeof value)) throw new Error(`connector 配置字段类型不支持: ${key}`);
    normalized[key] = value;
  }
  if (normalized.mode !== undefined && !["dry-run", "live"].includes(normalized.mode)) throw new Error("connector mode 只能是 dry-run 或 live");
  if (normalized.port !== undefined && (!Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535)) throw new Error("connector port 必须是 1-65535 的整数");
  return normalized;
}

function normalizeDeploymentConfig(config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const result = {};
  for (const channel of CONNECTOR_CHANNELS) {
    if (config[channel] !== undefined) result[channel] = normalizeConnectorSettings(config[channel]);
  }
  return result;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/^www\./, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeDomain(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
}

export function normalizeEmail(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

export function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").replace(/^00/, "+");
}

export function canonicalLeadId(input) {
  const domain = normalizeDomain(input.domain);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const company = normalizeText(input.company);
  const market = normalizeText(input.market);
  const basis = domain ? `domain:${domain}` : email ? `email:${email}` : phone ? `phone:${phone}` : `company:${market}:${company}`;
  return `lead_${createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

export function draftHash(draft) {
  return createHash("sha256")
    .update(`${draft.subject || ""}\n${draft.body || ""}`)
    .digest("hex");
}

function parseMarket(text) {
  const value = String(text || "");
  if (/(美国|美國|usa|united states|us)/i.test(value)) return "US";
  if (/(欧盟|欧洲|europe|eu)/i.test(value)) return "EU";
  if (/(日本|japan|jp)/i.test(value)) return "JP";
  if (/(东南亚|asean|sea|southeast asia)/i.test(value)) return "SEA";
  return "US";
}

function parseCount(text) {
  const match = String(text || "").match(/(\d+)\s*(?:个|家|名|customers?|leads?)/i);
  return Math.max(1, Math.min(50, Number(match?.[1] || 3)));
}

function parseProduct(text) {
  const value = String(text || "").trim();
  const beforeCustomer = value.split(/客户|买家|经销商|customer|buyer/i)[0].trim();
  return beforeCustomer
    .replace(/^(开发|寻找|开发美国|find|develop)\s*/i, "")
    .replace(/^\d+\s*(个|家|名)?\s*/i, "")
    .replace(/^(美国|美國|usa|united states|us|欧盟|欧洲|europe|eu|日本|japan|jp|东南亚|asean|sea)\s*/i, "")
    .trim() || "户外用品";
}

function now() {
  return new Date().toISOString();
}

export class JsonStore {
  #path;
  #mutex = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  get path() {
    return this.#path;
  }

  async #read() {
    try {
      return { ...clone(DEFAULT_STATE), ...(JSON.parse(await readFile(this.#path, "utf8")) || {}) };
    } catch (error) {
      if (error.code === "ENOENT") return clone(DEFAULT_STATE);
      throw error;
    }
  }

  async #write(value) {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, this.#path);
  }

  async read() {
    return this.#read();
  }

  async mutate(callback) {
    const operation = this.#mutex.then(async () => {
      const state = await this.#read();
      const result = await callback(state);
      await this.#write(state);
      return result;
    });
    this.#mutex = operation.catch(() => undefined);
    return operation;
  }
}

export class DryRunConnector {
  constructor(channel) {
    this.channel = channel;
    this.dryRun = true;
  }

  async validateRecipient(recipient) {
    return { valid: Boolean(recipient?.address || recipient?.domain), channel: this.channel, dry_run: true };
  }

  async createDraft(input) {
    return { connector: this.channel, status: "draft-only", dry_run: true, draft_id: `${this.channel}_${randomUUID()}`, input };
  }

  async send() {
    return { connector: this.channel, status: "blocked-dry-run", dry_run: true, sent: false, reason: "没有真实凭证，默认禁止外发" };
  }

  async syncStatus(input) {
    return { connector: this.channel, status: "synthetic", dry_run: true, input };
  }
}

export class ConnectorRegistry {
  #connectors = new Map();

  constructor(connectors = [new DryRunConnector("email"), new DryRunConnector("whatsapp"), new DryRunConnector("crm")]) {
    for (const connector of connectors) this.register(connector);
  }

  register(connector) {
    if (!connector?.channel || typeof connector.createDraft !== "function" || typeof connector.send !== "function") {
      throw new TypeError("connector 必须实现 channel、createDraft() 和 send() 接口");
    }
    this.#connectors.set(connector.channel, connector);
    return connector;
  }

  get(channel) {
    const connector = this.#connectors.get(channel);
    if (!connector) throw new Error(`connector 未注册: ${channel}`);
    return connector;
  }

  list() {
    return [...this.#connectors.values()].map((connector) => ({ channel: connector.channel, dry_run: connector.dryRun !== false }));
  }
}

export class SdrService {
  constructor({ store, connectors = new ConnectorRegistry(), clock = now, deploymentConfig = {}, allowAgentConfig = false, allowAgentLiveConfig = false } = {}) {
    if (!store) throw new TypeError("SdrService 需要 JsonStore");
    this.store = store;
    this.connectors = connectors;
    this.clock = clock;
    this.deploymentConfig = normalizeDeploymentConfig(deploymentConfig);
    this.allowAgentConfig = allowAgentConfig === true;
    this.allowAgentLiveConfig = allowAgentLiveConfig === true;
  }

  async createTask({ task, market = "", product = "", campaignVersion = "v2" }) {
    const request = String(task || "").trim();
    if (!request) throw new Error("task 不能为空");
    const resolvedMarket = market || parseMarket(request);
    const resolvedProduct = product || parseProduct(request);
    const targetCount = parseCount(request);
    const campaignKey = createHash("sha256").update(`${normalizeText(request)}|${resolvedMarket}|${normalizeText(resolvedProduct)}|${campaignVersion}`).digest("hex").slice(0, 20);
    return this.store.mutate((state) => {
      const existing = Object.values(state.tasks).find((item) => item.campaign_key === campaignKey);
      if (existing) return { ...this.summary(existing), idempotent_reuse: true };
      const taskId = `sdr_${this.clock().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
      const item = {
        task_id: taskId,
        task: request,
        market: resolvedMarket,
        product: resolvedProduct,
        target_count: targetCount,
        campaign_version: campaignVersion,
        campaign_key: campaignKey,
        stage: "task_parse",
        plan: {},
        prospects: [],
        research: {},
        scores: {},
        drafts: [],
        approvals: {},
        follow_ups: [],
        quotation_pack: [],
        report: null,
        created_at: this.clock(),
        updated_at: this.clock(),
      };
      this.#audit(state, item, "task.created", { campaign_key: campaignKey });
      state.tasks[taskId] = item;
      return this.summary(item);
    });
  }

  async nextStep(taskId) {
    return this.store.mutate(async (state) => {
      const item = this.#requireTask(state, taskId);
      let result;
      switch (item.stage) {
        case "task_parse":
          item.plan = { market: item.market, product: item.product, target_count: item.target_count, dry_run: true };
          item.stage = "prospect_discovery";
          result = { plan: item.plan };
          break;
        case "prospect_discovery":
          result = this.#discover(state, item);
          item.stage = "company_research";
          break;
        case "company_research":
          for (const lead of item.prospects) item.research[lead.canonical_lead_id] = { company: lead.company, evidence: [`synthetic public profile: ${lead.domain}`, "demo evidence only"] };
          item.stage = "prospect_scoring";
          result = { researched: item.prospects.length, dry_run: true };
          break;
        case "prospect_scoring":
          for (const [index, lead] of item.prospects.entries()) item.scores[lead.canonical_lead_id] = { score: Math.max(1, 20 - index), fit: "synthetic-fit", rationale: "market and product match" };
          item.stage = "email_draft";
          result = { scored: Object.keys(item.scores).length, dry_run: true };
          break;
        case "email_draft":
          this.#assertLeadOwnership(state, item);
          result = await this.#drafts(item);
          item.stage = "human_approval";
          break;
        case "human_approval":
          result = { blocked: true, reason: "等待人工审批。请调用 sdr_review_drafts，再调用 sdr_continue_after_approval。", pending: this.pending(item) };
          break;
        case "follow_up_plan":
          item.follow_ups = item.prospects.map((lead, index) => ({ lead_id: lead.canonical_lead_id, day: [2, 5, 10][index % 3], channel: "email", status: "planned" }));
          item.stage = "quotation_pack";
          result = { follow_ups: item.follow_ups };
          break;
        case "quotation_pack":
          item.quotation_pack = [{ product: item.product, market: item.market, source: "synthetic catalogue", status: "draft-only" }];
          item.stage = "close";
          result = { quotation_pack: item.quotation_pack };
          break;
        case "close":
          item.report = this.#report(item);
          result = { report: item.report };
          break;
        default:
          throw new Error(`未知阶段: ${item.stage}`);
      }
      item.updated_at = this.clock();
      this.#audit(state, item, "stage.completed", { stage: item.stage, result: this.#resultSummary(result) });
      return { result, task: this.summary(item) };
    });
  }

  async reviewDrafts(taskId, selectedIds, approver = "dsh-user") {
    return this.store.mutate((state) => {
      const item = this.#requireTask(state, taskId);
      if (item.stage !== "human_approval") throw new Error(`审批不可用，当前阶段为 ${item.stage}`);
      this.#assertLeadOwnership(state, item);
      const selected = new Set(selectedIds || []);
      const approved = [];
      for (const draft of item.drafts) {
        if (!selected.has(draft.email_id)) continue;
        const currentHash = draftHash(draft);
        if (currentHash !== draft.draft_hash) throw new Error(`草稿 ${draft.email_id} 哈希不匹配`);
        item.approvals[draft.email_id] = { status: "approved", approver, approved_at: this.clock(), draft_hash: currentHash };
        approved.push(draft.email_id);
      }
      this.#audit(state, item, "approval.recorded", { approved, pending: this.pending(item), approver });
      item.updated_at = this.clock();
      return { task_id: taskId, approved, pending: this.pending(item), requires_all_before_advance: true };
    });
  }

  async continueAfterApproval(taskId) {
    return this.store.mutate((state) => {
      const item = this.#requireTask(state, taskId);
      if (item.stage !== "human_approval") throw new Error(`审批后推进不可用，当前阶段为 ${item.stage}`);
      this.#assertLeadOwnership(state, item);
      const pending = this.pending(item);
      if (pending.length) throw new Error(`仍有 ${pending.length} 封草稿未获批准: ${pending.join(", ")}`);
      item.stage = "follow_up_plan";
      item.updated_at = this.clock();
      this.#audit(state, item, "approval.gate_passed", { approved_count: item.drafts.length });
      return { result: { advanced: true, stage: item.stage }, task: this.summary(item) };
    });
  }

  async getTask(taskId) {
    const state = await this.store.read();
    return this.summary(this.#requireTask(state, taskId));
  }

  async getReport(taskId) {
    const state = await this.store.read();
    const item = this.#requireTask(state, taskId);
    return item.stage === "close"
      ? { task_id: taskId, stage: item.stage, report: item.report || this.#report(item), complete: true }
      : { task_id: taskId, stage: item.stage, report: null, complete: false, next_action: item.stage === "human_approval" ? "sdr_review_drafts" : "sdr_next_step" };
  }

  async getDrafts(taskId) {
    const state = await this.store.read();
    const item = this.#requireTask(state, taskId);
    return { task_id: taskId, stage: item.stage, drafts: item.drafts, pending: this.pending(item) };
  }

  async auditLog(taskId) {
    const state = await this.store.read();
    this.#requireTask(state, taskId);
    return { task_id: taskId, entries: state.audit.filter((entry) => entry.task_id === taskId), count: state.audit.filter((entry) => entry.task_id === taskId).length };
  }

  async configureConnector({ channel, settings, actor = "sdr-agent" }) {
    if (!this.allowAgentConfig) throw new Error("Agent connector 配置未放行；部署时设置 DSH_SDR_AGENT_CONFIG=1 后重载插件");
    if (!CONNECTOR_CHANNELS.has(channel)) throw new Error(`不支持的 connector: ${channel}`);
    const patch = normalizeConnectorSettings(settings);
    if (patch.mode === "live" && !this.allowAgentLiveConfig) throw new Error("Agent 只能配置 dry-run；如需 live，部署时额外设置 DSH_SDR_AGENT_LIVE_CONFIG=1");
    return this.store.mutate((state) => {
      state.runtime_config ||= {};
      state.runtime_config[channel] = { ...(state.runtime_config[channel] || {}), ...patch, updated_at: this.clock(), updated_by: actor };
      state.audit.push({ event_id: randomUUID(), at: this.clock(), task_id: null, stage: "deployment", action: "connector.configured", detail: { channel, keys: Object.keys(patch), actor } });
      return { channel, applied_keys: Object.keys(patch), effective: this.#effectiveConnectorConfig(state, channel), deployment_config_preserved: true, secret_values_hidden: true };
    });
  }

  async connectorStatus() {
    const state = await this.store.read();
    return {
      connectors: this.connectors.list().map((connector) => ({ ...connector, deployment_config: this.#redactConfig(this.deploymentConfig[connector.channel] || {}), runtime_override: this.#redactConfig(state.runtime_config?.[connector.channel] || {}), effective_config: this.#redactConfig(this.#effectiveConnectorConfig(state, connector.channel)) })),
      agent_config: { enabled: this.allowAgentConfig, live_mode_enabled: this.allowAgentLiveConfig },
      policy: "部署配置是基线，Agent 只能在显式开关开启后写入白名单覆盖；密码、API key 和 token 值永远不进入工具参数或审计日志",
    };
  }

  pending(item) {
    return item.drafts.filter((draft) => item.approvals[draft.email_id]?.status !== "approved").map((draft) => draft.email_id);
  }

  summary(item) {
    return { task_id: item.task_id, task: item.task, stage: item.stage, stage_label: STAGE_LABELS[item.stage], market: item.market, product: item.product, prospects_count: item.prospects.length, drafts_count: item.drafts.length, pending_approvals: this.pending(item), follow_ups_count: item.follow_ups.length, quotation_count: item.quotation_pack.length, dry_run: true, updated_at: item.updated_at };
  }

  #requireTask(state, taskId) {
    const item = state.tasks[taskId];
    if (!item) throw new Error(`task not found: ${taskId}`);
    return item;
  }

  #audit(state, item, action, detail) {
    state.audit.push({ event_id: randomUUID(), at: this.clock(), task_id: item.task_id, stage: item.stage, action, detail });
  }

  #discover(state, item) {
    const available = syntheticCandidates(item.market).filter(([company, domain, market]) => {
      const candidate = { company, domain, market };
      const id = canonicalLeadId(candidate);
      const record = state.leads[id];
      return !record || record.suppression_status === "available";
    });
    const chosen = available.slice(0, item.target_count);
    item.prospects = chosen.map(([company, domain, market]) => {
      const lead = { canonical_lead_id: canonicalLeadId({ company, domain, market }), company, domain, market, source: "synthetic-demo" };
      state.leads[lead.canonical_lead_id] = { ...lead, suppression_status: "claimed", claimed_by: item.task_id, claimed_at: this.clock() };
      return lead;
    });
    return { prospects: item.prospects, dedupe: { requested: item.target_count, selected: item.prospects.length, skipped_duplicates: Math.max(0, item.target_count - item.prospects.length) }, dry_run: true };
  }

  async #drafts(item) {
    const connector = this.connectors.get("email");
    item.drafts = [];
    for (const [index, lead] of item.prospects.entries()) {
      const draft = { email_id: `draft_${index + 1}_${lead.canonical_lead_id.slice(-6)}`, lead_id: lead.canonical_lead_id, company: lead.company, subject: `${item.product} catalogue for ${lead.company}`, body: `Hello ${lead.company} team,\n\nWe prepared a synthetic ${item.product} catalogue for the ${item.market} market. Would a short review be useful?\n\nBest regards,\nSDR demo team`, channel: "email", citations: [`synthetic public profile: ${lead.domain}`], guardrail: "passed" };
      draft.draft_hash = draftHash(draft);
      const recipient = { domain: lead.domain };
      const validation = await connector.validateRecipient(recipient);
      if (!validation.valid) throw new Error(`收件人校验失败: ${lead.company}`);
      draft.connector = await connector.createDraft({ recipient, subject: draft.subject, body: draft.body });
      item.drafts.push(draft);
    }
    return { drafts: item.drafts, dry_run: true, channel: "email" };
  }

  #resultSummary(result) {
    if (!result || typeof result !== "object") return result;
    return { keys: Object.keys(result), count: Array.isArray(result.drafts) ? result.drafts.length : undefined };
  }

  #report(item) {
    return { task_id: item.task_id, status: "closed", market: item.market, product: item.product, prospects: item.prospects.map((lead) => ({ lead_id: lead.canonical_lead_id, company: lead.company, domain: lead.domain })), approved_drafts: Object.values(item.approvals).filter((approval) => approval.status === "approved").length, follow_up_count: item.follow_ups.length, quotation_pack_count: item.quotation_pack.length, external_delivery: "draft-only", dry_run: true };
  }

  #assertLeadOwnership(state, item) {
    for (const lead of item.prospects) {
      const record = state.leads[lead.canonical_lead_id];
      if (!record || record.claimed_by !== item.task_id || record.suppression_status !== "claimed") {
        throw new Error(`客户去重校验失败: ${lead.company}`);
      }
    }
  }

  #effectiveConnectorConfig(state, channel) {
    return { ...(this.deploymentConfig[channel] || {}), ...(state.runtime_config?.[channel] || {}) };
  }

  #redactConfig(config) {
    return Object.fromEntries(Object.entries(config).filter(([key]) => !SECRET_SETTING_PATTERN.test(key) || key.endsWith("_ref")));
  }
}

export function defaultStorePath(dshHome = process.env.DSH_HOME) {
  const home = dshHome || process.env.USERPROFILE || process.env.HOME || ".";
  return process.env.DSH_SDR_DATA_FILE || join(home, ".dsh-sdr", "state.json");
}

export { STAGE_LABELS };
