import { Module } from '@nestjs/common';
import { MetricsController } from '../../infrastructure/logging/metrics.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MetricsController],
})
export class MetricsModule {}
