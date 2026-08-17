export type ConnectorChannel = "email" | "whatsapp" | "crm";

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
