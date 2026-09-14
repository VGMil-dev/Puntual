import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NormalizedWebhookEvent, WebhookChannel } from './interfaces/normalized-event.interface';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  // TTL: 24 hours (86,400 seconds) to cover Meta and Telegram retry windows (RNF-011)
  private readonly DEDUP_TTL_SECONDS = 86400;

  constructor(
    private readonly redisService: RedisService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Verifies Meta Cloud API X-Hub-Signature-256 (RF-027)
   */
  verifyMetaSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!rawBody || !signatureHeader || !appSecret) {
      return false;
    }

    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
      return false;
    }

    const expectedSignature = parts[1];
    const hmac = crypto.createHmac('sha256', appSecret);
    hmac.update(rawBody);
    const calculatedSignature = hmac.digest('hex');

    if (expectedSignature.length !== calculatedSignature.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf-8'),
      Buffer.from(calculatedSignature, 'utf-8'),
    );
  }

  /**
   * Verifies Telegram Webhook secret token (RF-027)
   */
  verifyTelegramSecretToken(secretTokenHeader: string | undefined, expectedToken: string): boolean {
    if (!secretTokenHeader || !expectedToken) {
      return false;
    }

    if (secretTokenHeader.length !== expectedToken.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(secretTokenHeader, 'utf-8'),
      Buffer.from(expectedToken, 'utf-8'),
    );
  }

  /**
   * Checks and marks an event as processed in Redis (RNF-011)
   * Uses SET NX with 24h TTL.
   * Returns true if event is a DUPLICATE, false if event is NEW.
   */
  async checkDuplicate(channel: WebhookChannel, eventId: string): Promise<boolean> {
    const key = `webhook:dedup:${channel}:${eventId}`;
    const client = this.redisService.getClient();

    // NX sets the key only if it does not already exist
    const result = await client.set(key, 'processed', 'EX', this.DEDUP_TTL_SECONDS, 'NX');
    return result === null;
  }

  /**
   * Resolves clinicId by WhatsApp phone_number_id (Guía §11)
   */
  async resolveClinicByPhoneId(phoneNumberId: string): Promise<string | undefined> {
    if (!phoneNumberId) return undefined;
    const clinic = await this.prismaService.clinic.findUnique({
      where: { whatsappPhoneNumberId: phoneNumberId },
      select: { id: true },
    });
    return clinic?.id;
  }

  /**
   * Resolves clinicId by Telegram Bot Token Hash
   */
  async resolveClinicByTelegramToken(tokenHash: string): Promise<string | undefined> {
    if (!tokenHash) return undefined;
    const clinic = await this.prismaService.clinic.findFirst({
      where: { telegramBotTokenHash: tokenHash },
      select: { id: true },
    });
    return clinic?.id;
  }

  /**
   * Normalizes Meta Cloud API Webhook payload
   */
  normalizeMetaPayload(body: any, traceId: string, clinicId?: string): NormalizedWebhookEvent | null {
    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0]?.value;
      const message = change?.messages?.[0];

      if (!message) {
        return null;
      }

      return {
        traceId,
        channel: 'meta',
        clinicId,
        eventId: message.id,
        patientIdentifier: message.from,
        text: message.text?.body,
        payload: message,
        receivedAt: new Date(Number(message.timestamp) * 1000 || Date.now()),
      };
    } catch (error) {
      this.logger.error('Failed to parse Meta payload', error);
      return null;
    }
  }

  /**
   * Normalizes Telegram Webhook payload
   */
  normalizeTelegramPayload(body: any, traceId: string, clinicId?: string): NormalizedWebhookEvent | null {
    try {
      const message = body?.message;
      if (!message) {
        return null;
      }

      return {
        traceId,
        channel: 'telegram',
        clinicId,
        eventId: String(message.message_id),
        patientIdentifier: String(message.chat?.id),
        text: message.text,
        payload: message,
        receivedAt: new Date((message.date || 0) * 1000 || Date.now()),
      };
    } catch (error) {
      this.logger.error('Failed to parse Telegram payload', error);
      return null;
    }
  }
}
