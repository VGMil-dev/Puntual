import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requestContextStorage, StructuredLoggerService } from './structured-logger.service';

export interface CreateOperationalLogParams {
  traceId?: string;
  clinicId?: string;
  conversationId?: string;
  level: 'info' | 'warn' | 'error';
  category: 'auth' | 'channel_gateway' | 'ai' | 'calendar' | 'system';
  message: string;
  metadata?: Record<string, any>;
  latencyMs?: number;
}

@Injectable()
export class OperationalLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async record(params: CreateOperationalLogParams) {
    const store = requestContextStorage.getStore() || {};
    const traceId = params.traceId || store.traceId || 'unknown';
    const clinicId = params.clinicId || store.clinicId;
    const conversationId = params.conversationId || store.conversationId;

    try {
      const log = await this.prisma.operationalLog.create({
        data: {
          traceId,
          clinicId: clinicId || null,
          conversationId: conversationId || null,
          level: params.level,
          category: params.category,
          message: params.message,
          metadata: params.metadata || {},
          latencyMs: params.latencyMs || null,
        },
      });

      this.logger.log(`Operational log recorded: ${params.message}`, 'OperationalLogsService', {
        operationalLogId: log.id,
        category: params.category,
        level: params.level,
      });

      return log;
    } catch (err: any) {
      this.logger.error(
        `Failed to persist operational log: ${err.message}`,
        err.stack,
        'OperationalLogsService',
      );
      return null;
    }
  }

  async getAggregatedMetrics(clinicId?: string) {
    const where = clinicId ? { clinicId } : {};

    const totalLogs = await this.prisma.operationalLog.count({ where });
    const errorsCount = await this.prisma.operationalLog.count({
      where: { ...where, level: 'error' },
    });

    const categoryGroups = await this.prisma.operationalLog.groupBy({
      by: ['category'],
      _count: { id: true },
      where,
    });

    const logsWithLatency = await this.prisma.operationalLog.findMany({
      where: {
        ...where,
        latencyMs: { not: null },
      },
      select: { latencyMs: true },
      orderBy: { latencyMs: 'asc' },
    });

    let p50Latency = 0;
    let p95Latency = 0;

    if (logsWithLatency.length > 0) {
      const latencies = logsWithLatency.map((l) => l.latencyMs as number);
      const idx50 = Math.floor(latencies.length * 0.5);
      const idx95 = Math.floor(latencies.length * 0.95);
      p50Latency = latencies[idx50];
      p95Latency = latencies[idx95];
    }

    return {
      totalLogs,
      errorsCount,
      successRate: totalLogs > 0 ? ((totalLogs - errorsCount) / totalLogs) * 100 : 100,
      latency: {
        p50Ms: p50Latency,
        p95Ms: p95Latency,
      },
      byCategory: categoryGroups.map((cg) => ({
        category: cg.category,
        count: cg._count.id,
      })),
    };
  }
}
