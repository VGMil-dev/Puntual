import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [RedisModule, PrismaModule, ChannelsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
