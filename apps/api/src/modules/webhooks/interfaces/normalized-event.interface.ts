export type WebhookChannel = 'meta' | 'telegram';

export interface NormalizedWebhookEvent {
  traceId: string;
  channel: WebhookChannel;
  clinicId?: string;
  eventId: string; // message_id / event_id for idempotency
  patientIdentifier: string; // Phone number for WhatsApp, chat_id for Telegram
  text?: string;
  payload?: any;
  receivedAt: Date;
}
