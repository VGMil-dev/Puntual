import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as crypto from 'crypto';
import { Request, Response } from 'express';
import {
  requestContextStorage,
  StructuredLoggerService,
} from './structured-logger.service';

@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  constructor(private readonly logger: StructuredLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const traceId = (req.headers['x-trace-id'] as string) || crypto.randomUUID();
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    const clinicId = (req.headers['x-clinic-id'] as string) || (req as any).user?.clinicId;
    const conversationId = (req.headers['x-conversation-id'] as string) || undefined;

    if (res && res.setHeader) {
      res.setHeader('X-Trace-Id', traceId);
      res.setHeader('X-Request-Id', requestId);
    }

    const contextStore = {
      traceId,
      requestId,
      clinicId,
      conversationId,
    };

    const startAt = Date.now();

    return new Observable((observer) => {
      requestContextStorage.run(contextStore, () => {
        this.logger.log(`HTTP ${req.method} ${req.url} started`, 'TraceIdInterceptor', {
          method: req.method,
          url: req.url,
        });

        next
          .handle()
          .pipe(
            tap({
              next: () => {
                const latencyMs = Date.now() - startAt;
                this.logger.log(
                  `HTTP ${req.method} ${req.url} completed [${res.statusCode || 200}] in ${latencyMs}ms`,
                  'TraceIdInterceptor',
                  {
                    method: req.method,
                    url: req.url,
                    statusCode: res.statusCode || 200,
                    latencyMs,
                  },
                );
              },
              error: (err) => {
                const latencyMs = Date.now() - startAt;
                this.logger.error(
                  `HTTP ${req.method} ${req.url} failed: ${err.message}`,
                  err.stack,
                  'TraceIdInterceptor',
                  {
                    method: req.method,
                    url: req.url,
                    statusCode: err.status || 500,
                    latencyMs,
                  },
                );
              },
            }),
          )
          .subscribe(observer);
      });
    });
  }
}
