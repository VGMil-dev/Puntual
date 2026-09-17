export const EMAIL_PORT = Symbol('EMAIL_PORT');

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface SentEmailRecord {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from: string;
  messageId: string;
  timestamp: Date;
}

export interface EmailPort {
  sendEmail(options: SendEmailOptions): Promise<{ success: boolean; messageId: string }>;
  getSentEmails?(): SentEmailRecord[];
  clearSentEmails?(): void;
}
