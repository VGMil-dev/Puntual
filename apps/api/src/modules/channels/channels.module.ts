import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ChannelGatewayService } from './channel-gateway.service';
import { ChannelsController } from './channels.controller';
import { AuthModule } from '../auth/auth.module';
import { InfisicalModule } from '../../integrations/secrets/infisical/infisical.module';
import { LoggingModule } from '../../infrastructure/logging/logging.module';

@Module({
  imports: [AuthModule, InfisicalModule, LoggingModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelGatewayService],
  exports: [ChannelsService, ChannelGatewayService],
})
export class ChannelsModule {}
