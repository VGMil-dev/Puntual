import { Injectable } from '@nestjs/common';
import { EmailPort, SendEmailOptions, SentEmailRecord } from '../email.port';
import { StructuredLoggerService } from '../../../infrastructure/logging/structured-logger.service';
import * as crypto from 'crypto';

@Injectable()
export class SmtpEmailAdapter implements EmailPort {
  private sentEmails: SentEmailRecord[] = [];
  private defaultFrom: string;

  constructor(private readonly logger: StructuredLoggerService) {
    this.defaultFrom = process.env.EMAIL_FROM || 'Puntual <soporte@puntual.app>';
  }

  async sendEmail(options: SendEmailOptions): Promise<{ success: boolean; messageId: string }> {
    const messageId = `msg_${crypto.randomUUID()}`;
    const from = options.from || this.defaultFrom;

    const emailRecord: SentEmailRecord = {
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      from,
      messageId,
      timestamp: new Date(),
    };

    this.sentEmails.push(emailRecord);

    this.logger.log(`Email dispatched to ${options.to}: "${options.subject}"`, 'SmtpEmailAdapter', {
      to: options.to,
      subject: options.subject,
      messageId,
      from,
    });

    return { success: true, messageId };
  }

  getSentEmails(): SentEmailRecord[] {
    return [...this.sentEmails];
  }

  clearSentEmails(): void {
    this.sentEmails = [];
  }
}
