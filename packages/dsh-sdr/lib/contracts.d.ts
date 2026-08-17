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
