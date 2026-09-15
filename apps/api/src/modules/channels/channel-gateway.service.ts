import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { ChannelsService } from './channels.service';
import { ChannelType } from '@prisma/client';

@Injectable()
export class ChannelGatewayService {
  private readonly cacheTtlSeconds = 300; // 5 minutes cache in Redis

  static getWhatsAppCacheKey(phoneNumberId: string): string {
    return `gateway:whatsapp:${phoneNumberId}:clinicId`;
  }

  static getTelegramCacheKey(identifier: string): string {
    return `gateway:telegram:${identifier}:clinicId`;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly channelsService: ChannelsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async resolveClinicByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    const cacheKey = ChannelGatewayService.getWhatsAppCacheKey(phoneNumberId);
    const cachedClinicId = await this.redis.get(cacheKey);
    if (cachedClinicId) {
      return cachedClinicId;
    }

    const cred = await this.prisma.channelCredential.findUnique({
      where: {
        channelType_identifier: {
          channelType: ChannelType.WHATSAPP,
          identifier: phoneNumberId,
        },
      },
    });

    if (cred && cred.isActive) {
      await this.redis.set(cacheKey, cred.clinicId, this.cacheTtlSeconds);
      return cred.clinicId;
    }

    // Fallback check on Clinic.whatsappPhoneNumberId
    const clinic = await this.prisma.clinic.findUnique({
      where: { whatsappPhoneNumberId: phoneNumberId },
      select: { id: true },
    });

    if (clinic) {
      await this.redis.set(cacheKey, clinic.id, this.cacheTtlSeconds);
      return clinic.id;
    }

    this.logger.warn(`Could not resolve clinic for WhatsApp phone_number_id: ${phoneNumberId}`, 'ChannelGatewayService');
    return null;
  }

  async resolveClinicByTelegramIdentifier(identifier: string): Promise<string | null> {
    const cacheKey = ChannelGatewayService.getTelegramCacheKey(identifier);
    const cachedClinicId = await this.redis.get(cacheKey);
    if (cachedClinicId) {
      return cachedClinicId;
    }

    const cred = await this.prisma.channelCredential.findUnique({
      where: {
        channelType_identifier: {
          channelType: ChannelType.TELEGRAM,
          identifier,
        },
      },
    });

    if (cred && cred.isActive) {
      await this.redis.set(cacheKey, cred.clinicId, this.cacheTtlSeconds);
      return cred.clinicId;
    }

    return null;
  }

  async getClinicChannelCredentials(
    channelType: ChannelType,
    identifier: string,
  ): Promise<{ clinicId: string; token: string; appSecret?: string } | null> {
    const cred = await this.prisma.channelCredential.findUnique({
      where: {
        channelType_identifier: {
          channelType,
          identifier,
        },
      },
    });

    if (!cred || !cred.isActive) {
      return null;
    }

    try {
      const decrypted = this.channelsService.decryptToken(cred.encryptedToken);
      try {
        const parsed = JSON.parse(decrypted);
        if (parsed && typeof parsed === 'object' && parsed.token) {
          return {
            clinicId: cred.clinicId,
            token: parsed.token,
            appSecret: parsed.appSecret,
          };
        }
      } catch {
        // Not a JSON payload, pure token
      }

      return {
        clinicId: cred.clinicId,
        token: decrypted,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to decrypt channel credentials for ${channelType}:${identifier}: ${err.message}`,
        err.stack,
        'ChannelGatewayService',
      );
      return null;
    }
  }

  async getDecryptedTokenForClinic(clinicId: string, channelType: ChannelType): Promise<string | null> {
    const cred = await this.prisma.channelCredential.findFirst({
      where: {
        clinicId,
        channelType,
        isActive: true,
      },
    });

    if (!cred) {
      return null;
    }

    try {
      const decrypted = this.channelsService.decryptToken(cred.encryptedToken);
      try {
        const parsed = JSON.parse(decrypted);
        if (parsed && typeof parsed === 'object' && parsed.token) {
          return parsed.token;
        }
      } catch {
        // pure string token
      }
      return decrypted;
    } catch (err: any) {
      this.logger.error(`Failed to decrypt channel token for clinic ${clinicId}: ${err.message}`, err.stack, 'ChannelGatewayService');
      return null;
    }
  }
}
