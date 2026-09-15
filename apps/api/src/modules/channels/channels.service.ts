import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import {
  SECRET_STORE_PORT,
  SecretStorePort,
} from '../../integrations/secrets/secret-store.port';
import { SaveChannelCredentialsDto } from './dto/save-channel-credentials.dto';
import * as crypto from 'crypto';
import { ChannelType } from '@prisma/client';

@Injectable()
export class ChannelsService {
  private readonly algorithm = 'aes-256-gcm';
  private encryptionKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly logger: StructuredLoggerService,
    @Inject(SECRET_STORE_PORT) private readonly secretStore: SecretStorePort,
  ) {
    const rawKey =
      process.env.ENCRYPTION_KEY ||
      process.env.JWT_SECRET ||
      'puntual-sprint2-default-aes-key-must-be-32-chars!!';
    this.encryptionKey = crypto.createHash('sha256').update(rawKey).digest();
  }

  encryptToken(plainText: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decryptToken(cipherPayload: string): string {
    const [ivHex, authTagHex, encryptedHex] = cipherPayload.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error('Invalid cipher payload format');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async saveCredentials(clinicId: string, dto: SaveChannelCredentialsDto) {
    // Encrypt token before persisting
    const encryptedToken = this.encryptToken(dto.token);

    // Upsert credential for this channel and identifier
    const credential = await this.prisma.channelCredential.upsert({
      where: {
        channelType_identifier: {
          channelType: dto.channelType,
          identifier: dto.identifier,
        },
      },
      update: {
        clinicId,
        encryptedToken,
        isActive: true,
      },
      create: {
        clinicId,
        channelType: dto.channelType,
        identifier: dto.identifier,
        encryptedToken,
        isActive: true,
      },
    });

    // Also update legacy/quick reference fields on Clinic if appropriate
    if (dto.channelType === ChannelType.WHATSAPP) {
      await this.prisma.clinic.update({
        where: { id: clinicId },
        data: { whatsappPhoneNumberId: dto.identifier },
      });
    }

    // Invalidate cached gateway resolution
    if (dto.channelType === ChannelType.WHATSAPP) {
      await this.redis.del(`gateway:phone:${dto.identifier}`);
    } else if (dto.channelType === ChannelType.TELEGRAM) {
      await this.redis.del(`gateway:telegram:${dto.identifier}`);
    }

    this.logger.log(
      `Channel credentials saved for clinic ${clinicId} on ${dto.channelType}`,
      'ChannelsService',
      { clinicId, channelType: dto.channelType, identifier: dto.identifier },
    );

    return {
      id: credential.id,
      clinicId: credential.clinicId,
      channelType: credential.channelType,
      identifier: credential.identifier,
      isActive: credential.isActive,
      updatedAt: credential.updatedAt,
    };
  }

  async listCredentials(clinicId: string) {
    const creds = await this.prisma.channelCredential.findMany({
      where: { clinicId },
      select: {
        id: true,
        clinicId: true,
        channelType: true,
        identifier: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return creds;
  }

  async deleteCredentials(clinicId: string, id: string) {
    const cred = await this.prisma.channelCredential.findUnique({
      where: { id },
    });

    if (!cred) {
      throw new NotFoundException(`Credential with id ${id} not found`);
    }

    if (cred.clinicId !== clinicId) {
      throw new ForbiddenException('Cannot delete credentials from another clinic');
    }

    await this.prisma.channelCredential.delete({ where: { id } });

    if (cred.channelType === ChannelType.WHATSAPP) {
      await this.redis.del(`gateway:phone:${cred.identifier}`);
    } else if (cred.channelType === ChannelType.TELEGRAM) {
      await this.redis.del(`gateway:telegram:${cred.identifier}`);
    }

    return { message: 'Channel credential removed successfully' };
  }
}
