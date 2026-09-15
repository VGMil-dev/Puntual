import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ChannelType } from '@prisma/client';

export class SaveChannelCredentialsDto {
  @IsEnum(ChannelType)
  channelType: ChannelType;

  @IsString()
  @IsNotEmpty()
  identifier: string; // phone_number_id for WhatsApp, bot_username or secret token for Telegram

  @IsString()
  @IsNotEmpty()
  token: string; // Plain token provided by clinic admin, which will be encrypted before storage

  @IsString()
  @IsOptional()
  appSecret?: string; // Optional Meta App Secret or Telegram webhook secret token
}
