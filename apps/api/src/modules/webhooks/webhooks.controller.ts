import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  Res,
  HttpStatus,
  Logger,
  RawBodyRequest,
  Query,
  HttpCode,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { WebhooksService } from './webhooks.service';
import { WebhookChannel } from './interfaces/normalized-event.interface';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Meta Webhook Verification Challenge (GET /webhooks/meta)
   */
  @Get('meta')
  verifyMetaWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expectedToken = process.env.META_VERIFY_TOKEN || 'test_meta_verify_token';

    if (mode === 'subscribe' && token === expectedToken) {
      this.logger.log('Meta webhook challenge verified successfully');
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn('Meta webhook challenge failed verification');
    return res.status(HttpStatus.FORBIDDEN).send('Forbidden');
  }

  /**
   * Channel Webhook Handler (POST /webhooks/:channel)
   * Enforces signature verification and deduplication before processing (RF-027, RNF-011)
   */
  @Post(':channel')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('channel') channel: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    const traceId = (req.headers['x-trace-id'] as string) || crypto.randomUUID();

    if (channel !== 'meta' && channel !== 'telegram') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'Unsupported channel',
        traceId,
      });
    }

    const typedChannel = channel as WebhookChannel;

    // 1. Signature / Secret verification BEFORE any processing (RF-027)
    if (typedChannel === 'meta') {
      const signatureHeader = req.headers['x-hub-signature-256'] as string;
      const appSecret = process.env.META_APP_SECRET || 'test_meta_app_secret';

      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
      const isValid = this.webhooksService.verifyMetaSignature(rawBody, signatureHeader, appSecret);

      if (!isValid) {
        this.logger.warn(
          JSON.stringify({
            action: 'webhook_rejected',
            channel: 'meta',
            reason: 'invalid_signature',
            traceId,
          }),
        );
        return res.status(HttpStatus.UNAUTHORIZED).json({
          error: 'Invalid signature',
          traceId,
        });
      }
    } else if (typedChannel === 'telegram') {
      const secretTokenHeader = req.headers['x-telegram-bot-api-secret-token'] as string;
      const expectedToken = process.env.TELEGRAM_SECRET_TOKEN || 'test_telegram_secret_token';

      const isValid = this.webhooksService.verifyTelegramSecretToken(secretTokenHeader, expectedToken);

      if (!isValid) {
        this.logger.warn(
          JSON.stringify({
            action: 'webhook_rejected',
            channel: 'telegram',
            reason: 'invalid_secret_token',
            traceId,
          }),
        );
        return res.status(HttpStatus.FORBIDDEN).json({
          error: 'Invalid secret token',
          traceId,
        });
      }
    }

    // 2. Resolve Clinic & Normalize Event (Guía §11)
    let clinicId: string | undefined;
    let normalizedEvent = null;

    if (typedChannel === 'meta') {
      const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      if (phoneNumberId) {
        clinicId = await this.webhooksService.resolveClinicByPhoneId(phoneNumberId);
      }
      normalizedEvent = this.webhooksService.normalizeMetaPayload(req.body, traceId, clinicId);
    } else if (typedChannel === 'telegram') {
      const tokenHash = req.headers['x-telegram-bot-token-hash'] as string;
      if (tokenHash) {
        clinicId = await this.webhooksService.resolveClinicByTelegramToken(tokenHash);
      }
      normalizedEvent = this.webhooksService.normalizeTelegramPayload(req.body, traceId, clinicId);
    }

    // If payload does not contain actionable message (e.g. status updates or ping)
    if (!normalizedEvent || !normalizedEvent.eventId) {
      this.logger.log(
        JSON.stringify({
          action: 'webhook_acknowledged_non_message',
          channel: typedChannel,
          traceId,
          clinicId,
        }),
      );
      return res.status(HttpStatus.OK).json({ status: 'acknowledged', traceId });
    }

    // 3. Idempotency & Deduplication Check (RNF-011)
    const isDuplicate = await this.webhooksService.checkDuplicate(typedChannel, normalizedEvent.eventId);

    if (isDuplicate) {
      this.logger.warn(
        JSON.stringify({
          action: 'webhook_duplicate',
          channel: typedChannel,
          eventId: normalizedEvent.eventId,
          traceId,
          clinicId,
          status: 'duplicate_ignored',
        }),
      );
      return res.status(HttpStatus.OK).json({
        status: 'duplicate_ignored',
        eventId: normalizedEvent.eventId,
        traceId,
      });
    }

    // 4. Structured log for accepted, normalized event (DoD §4)
    this.logger.log(
      JSON.stringify({
        action: 'webhook_processed',
        channel: typedChannel,
        eventId: normalizedEvent.eventId,
        patientIdentifier: normalizedEvent.patientIdentifier,
        traceId,
        clinicId,
        status: 'accepted',
      }),
    );

    return res.status(HttpStatus.OK).json({
      status: 'accepted',
      eventId: normalizedEvent.eventId,
      traceId,
      clinicId,
    });
  }
}
