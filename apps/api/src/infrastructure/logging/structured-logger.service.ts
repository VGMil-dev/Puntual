import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  traceId?: string;
  requestId?: string;
  clinicId?: string;
  conversationId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

@Injectable({ scope: Scope.DEFAULT })
export class StructuredLoggerService implements LoggerService {
  private formatLog(
    level: string,
    message: any,
    context?: string,
    additionalMetadata?: Record<string, any>,
  ): string {
    const store = requestContextStorage.getStore() || {};

    const logObject = {
      timestamp: new Date().toISOString(),
      level,
      traceId: store.traceId || additionalMetadata?.traceId,
      requestId: store.requestId || additionalMetadata?.requestId,
      clinicId: store.clinicId || additionalMetadata?.clinicId,
      conversationId: store.conversationId || additionalMetadata?.conversationId,
      context: context || 'Application',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      ...additionalMetadata,
    };

    // Sanitize any sensitive tokens/passwords if accidentally present
    if (logObject.message && typeof logObject.message === 'string') {
      logObject.message = logObject.message
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
        .replace(/password['"]?\s*[:=]\s*['"][^'"]+['"]/gi, 'password:"[REDACTED]"');
    }

    return JSON.stringify(logObject);
  }

  log(message: any, context?: string, metadata?: Record<string, any>) {
    process.stdout.write(this.formatLog('info', message, context, metadata) + '\n');
  }

  error(message: any, trace?: string, context?: string, metadata?: Record<string, any>) {
    process.stderr.write(
      this.formatLog('error', message, context, { stack: trace, ...metadata }) + '\n',
    );
  }

  warn(message: any, context?: string, metadata?: Record<string, any>) {
    process.stdout.write(this.formatLog('warn', message, context, metadata) + '\n');
  }

  debug(message: any, context?: string, metadata?: Record<string, any>) {
    process.stdout.write(this.formatLog('debug', message, context, metadata) + '\n');
  }

  verbose(message: any, context?: string, metadata?: Record<string, any>) {
    process.stdout.write(this.formatLog('verbose', message, context, metadata) + '\n');
  }
}
