import { Global, Module } from '@nestjs/common';
import { StructuredLoggerService } from './structured-logger.service';
import { TraceIdInterceptor } from './trace-id.interceptor';
import { OperationalLogsService } from './operational-logs.service';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [StructuredLoggerService, TraceIdInterceptor, OperationalLogsService],
  exports: [StructuredLoggerService, TraceIdInterceptor, OperationalLogsService],
})
export class LoggingModule {}
