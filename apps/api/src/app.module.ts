import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { TraceIdInterceptor } from './infrastructure/logging/trace-id.interceptor';
import { HealthModule } from './modules/health/health.module';
import { InfisicalModule } from './integrations/secrets/infisical/infisical.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClinicsModule } from './modules/clinics/clinics.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    LoggingModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    InfisicalModule,
    AuthModule,
    ClinicsModule,
    ChannelsModule,
    CalendarModule,
    DoctorsModule,
    AiModule,
    WebhooksModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TraceIdInterceptor,
    },
  ],
})
export class AppModule {}
