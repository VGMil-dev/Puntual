import { Global, Module } from '@nestjs/common';
import { StructuredLoggerService } from './structured-logger.service';
import { TraceIdInterceptor } from './trace-id.interceptor';
import { OperationalLogsService } from './operational-logs.service';

@Global()
@Module({
  providers: [StructuredLoggerService, TraceIdInterceptor, OperationalLogsService],
  exports: [StructuredLoggerService, TraceIdInterceptor, OperationalLogsService],
})
export class LoggingModule {}

