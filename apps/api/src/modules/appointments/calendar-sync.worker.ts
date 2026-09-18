import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { CALENDAR_PORT, CalendarPort } from '../calendar/ports/calendar.port';

export interface CalendarSyncSweepOptions {
  nowOverride?: Date;
}

export interface CalendarSyncSweepResult {
  scannedJobs: number;
  succeededJobs: number;
  retriedJobs: number;
  failedJobs: number;
  processedJobIds: string[];
}

/**
 * Calculates next retry delay in seconds based on exponential backoff (RNF-006 / Decisión D9).
 * - Attempt 1: 1 min (60s)
 * - Attempt 2: 5 min (300s)
 * - Attempt 3: 30 min (1800s)
 * - Attempt 4: 2 hours (7200s)
 * - Attempt 5: 6 hours (21600s)
 */
export function calculateCalendarSyncBackoffDelaySeconds(attempts: number): number {
  switch (attempts) {
    case 1:
      return 60;
    case 2:
      return 300;
    case 3:
      return 1800;
    case 4:
      return 7200;
    default:
      return 21600;
  }
}

@Injectable()
export class CalendarSyncWorker implements OnModuleInit, OnModuleDestroy {
  private intervalRef?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CALENDAR_PORT) private readonly calendarPort: CalendarPort,
    private readonly logger: StructuredLoggerService,
  ) {}

  onModuleInit() {
    const intervalSeconds = parseInt(
      process.env.CALENDAR_SYNC_INTERVAL_SECONDS || '60',
      10,
    );
    if (intervalSeconds > 0 && process.env.NODE_ENV !== 'test') {
      this.intervalRef = setInterval(async () => {
        try {
          await this.sweepPendingJobs();
        } catch (err: any) {
          this.logger.error(
            `Failed to sweep pending calendar sync jobs: ${err?.message}`,
            err?.stack,
            'CalendarSyncWorker',
          );
        }
      }, intervalSeconds * 1000);
      this.intervalRef.unref();
    }
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
    }
  }

  /**
   * Sweeps pending calendar_sync jobs and attempts Google Calendar synchronization with backoff (RNF-006, H3).
   * - Max 5 attempts in 24h.
   * - Transitions to FAILED on 5th failure and logs Super Admin alert.
   */
  async sweepPendingJobs(
    options?: CalendarSyncSweepOptions,
  ): Promise<CalendarSyncSweepResult> {
    const now = options?.nowOverride || new Date();

    const pendingJobs = await this.prisma.scheduledJob.findMany({
      where: {
        type: 'calendar_sync',
        status: JobStatus.PENDING,
        attempts: { lt: 5 },
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    const result: CalendarSyncSweepResult = {
      scannedJobs: pendingJobs.length,
      succeededJobs: 0,
      retriedJobs: 0,
      failedJobs: 0,
      processedJobIds: [],
    };

    for (const job of pendingJobs) {
      result.processedJobIds.push(job.id);
      const payload = job.payload as any;

      if (!payload || !payload.calendarId || !payload.startAt || !payload.endAt) {
        // Payload corrupt or missing essential data
        const updated = await this.prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.FAILED,
            lastError: 'Payload missing required calendar fields (calendarId, startAt, endAt)',
            updatedAt: now,
          },
        });
        result.failedJobs++;
        continue;
      }

      try {
        const calendarEventId = await this.calendarPort.createEvent({
          calendarId: payload.calendarId,
          refreshTokenCipher: payload.refreshTokenCipher || '',
          summary: payload.summary || 'Cita Odontológica Puntual',
          description: payload.description || '',
          startAt: new Date(payload.startAt),
          endAt: new Date(payload.endAt),
        });

        // Success: update Appointment and ScheduledJob
        await this.prisma.$transaction([
          this.prisma.appointment.update({
            where: { id: job.entityId },
            data: {
              googleCalendarEventId: calendarEventId,
              updatedAt: now,
            },
          }),
          this.prisma.scheduledJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.COMPLETED,
              updatedAt: now,
            },
          }),
        ]);

        this.logger.log(
          `CalendarSyncSucceeded: Event ${calendarEventId} created successfully for appointment ${job.entityId}`,
          'CalendarSyncWorker',
          {
            clinicId: job.clinicId,
            appointmentId: job.entityId,
            scheduledJobId: job.id,
            calendarEventId,
            attempts: job.attempts,
          },
        );

        result.succeededJobs++;
      } catch (err: any) {
        const newAttempts = job.attempts + 1;
        const errorMessage = err?.message || String(err);

        if (newAttempts >= 5) {
          // Max attempts reached: transition to FAILED and alert Super Admin (RNF-006)
          await this.prisma.scheduledJob.update({
            where: { id: job.id },
            data: {
              attempts: newAttempts,
              status: JobStatus.FAILED,
              lastError: errorMessage,
              updatedAt: now,
            },
          });

          this.logger.error(
            `CalendarSyncPermanentFailure: Maximum retry attempts (${newAttempts}) exhausted for appointment ${job.entityId} in clinic ${job.clinicId}. Super Admin alert dispatched.`,
            err?.stack,
            'CalendarSyncWorker',
            {
              clinicId: job.clinicId,
              appointmentId: job.entityId,
              scheduledJobId: job.id,
              attempts: newAttempts,
              errorMessage,
              alertTarget: 'SuperAdmin',
            },
          );

          result.failedJobs++;
        } else {
          // Schedule next retry with exponential backoff
          const delaySeconds = calculateCalendarSyncBackoffDelaySeconds(newAttempts);
          const nextRetryAt = new Date(now.getTime() + delaySeconds * 1000);

          await this.prisma.scheduledJob.update({
            where: { id: job.id },
            data: {
              attempts: newAttempts,
              nextRetryAt,
              lastError: errorMessage,
              updatedAt: now,
            },
          });

          this.logger.warn(
            `CalendarSyncRetryScheduled: Attempt ${newAttempts}/5 failed for appointment ${job.entityId}. Next retry scheduled at ${nextRetryAt.toISOString()}`,
            'CalendarSyncWorker',
            {
              clinicId: job.clinicId,
              appointmentId: job.entityId,
              scheduledJobId: job.id,
              attempts: newAttempts,
              nextRetryAt: nextRetryAt.toISOString(),
              delaySeconds,
              errorMessage,
            },
          );

          result.retriedJobs++;
        }
      }
    }

    return result;
  }
}
