import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ChannelType } from '@prisma/client';

export class SaveChannelCredentialsDto {
  @IsEnum(ChannelType)
  channelType: ChannelType;

  @IsString()
  @IsNotEmpty()
  identifier: string; // phone_number_id for WhatsApp, bot_username for Telegram

  @IsString()
  @IsNotEmpty()
  token: string; // Plain token provided by clinic admin, which will be encrypted before storage
}
