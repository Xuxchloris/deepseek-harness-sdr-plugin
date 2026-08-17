export type ConnectorChannel = "email" | "whatsapp" | "crm";

export interface ConnectorSettings {
  provider?: string;
  mode?: "dry-run" | "live";
  enabled?: boolean;
  from?: string;
  base_url?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  phone_number_id?: string;
  tenant?: string;
  username_ref?: string;
  password_ref?: string;
  api_key_ref?: string;
  credential_ref?: string;
}

export interface Recipient {
  address?: string;
  domain?: string;
  phone?: string;
  leadId?: string;
}

export interface ValidationResult {
  valid: boolean;
  channel: ConnectorChannel;
  dry_run: boolean;
  reason?: string;
}

export interface DraftInput {
  recipient: Recipient;
  subject: string;
  body: string;
}

export interface ApprovedMessage {
  taskId: string;
  leadId: string;
  draftHash: string;
  payload: unknown;
}

export interface OutreachConnector {
  readonly channel: ConnectorChannel;
  readonly dryRun: boolean;
  validateRecipient(input: Recipient): Promise<ValidationResult>;
  createDraft(input: DraftInput): Promise<Record<string, unknown>>;
  send(input: ApprovedMessage): Promise<Record<string, unknown>>;
  syncStatus(input: unknown): Promise<Record<string, unknown>>;
}

export interface ConnectorConfigRequest {
  channel: ConnectorChannel;
  settings: ConnectorSettings;
}

export type KnowledgeType = "product" | "brand" | "policy" | "case" | "market" | "company";

export interface KnowledgeRecord {
  knowledge_id: string;
  type: KnowledgeType;
  title: string;
  content: string;
  tags: string[];
  source: string;
  version: number;
  status: "approved";
  chunk_count?: number;
  updated_at: string;
  updated_by: string;
}

export interface KnowledgeSearchResult extends KnowledgeRecord {
  relevance: number;
  citation: string;
  retrieval: {
    lexical: number;
    semantic: number;
    reranked: number;
    matched_chunks: Array<{ chunk_id: string; score: number; excerpt: string }>;
  };
}

export interface RetrievalEvaluation {
  k: number;
  queries: number;
  recall_at_k: number;
  mrr: number;
  per_query: Array<{
    query: string;
    expected: string[];
    hits: string[];
    recall_at_k: number;
    reciprocal_rank: number;
  }>;
}

export interface KnowledgeRepository {
  upsert(input: Omit<KnowledgeRecord, "knowledge_id" | "version" | "status" | "updated_at" | "updated_by">): Promise<KnowledgeRecord>;
  search(query: string, options?: { types?: KnowledgeType[]; limit?: number }): Promise<KnowledgeSearchResult[]>;
  list(options?: { type?: KnowledgeType }): Promise<KnowledgeRecord[]>;
  evaluate(input: { queries: Array<{ text: string; types?: KnowledgeType[]; relevant_knowledge_ids: string[] }>; k?: number }): Promise<RetrievalEvaluation>;
}
