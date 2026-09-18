import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Appointment, AppointmentStatus, JobStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';

export interface SweepOptions {
  nowOverride?: Date;
}

export interface SweepResult {
  expiredCount: number;
  processedJobIds: string[];
}

@Injectable()
export class ExpirationService implements OnModuleInit, OnModuleDestroy {
  private intervalRef?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly logger: StructuredLoggerService,
  ) {}

  onModuleInit() {
    const intervalSeconds = parseInt(
      process.env.HOLD_SWEEPER_INTERVAL_SECONDS || '60',
      10,
    );
    if (intervalSeconds > 0 && process.env.NODE_ENV !== 'test') {
      this.intervalRef = setInterval(async () => {
        try {
          await this.sweepExpiredHolds();
        } catch (err: any) {
          this.logger.error(
            `Failed to sweep expired holds in periodic background job: ${err?.message}`,
            err?.stack,
            'ExpirationService',
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
   * Standardized slot lock key generator matching HoldService format.
   * Format: hold:slot:${clinicId}:${doctorId}:${startAtIso}
   */
  getSlotKey(clinicId: string, doctorId: string, startAtIso: string): string {
    return `hold:slot:${clinicId}:${doctorId}:${startAtIso}`;
  }

  /**
   * Standardized doctor hold counter key generator matching HoldService format.
   * Format: hold:count:${clinicId}:${doctorId}
   */
  getCounterKey(clinicId: string, doctorId: string): string {
    return `hold:count:${clinicId}:${doctorId}`;
  }

  /**
   * Reconciles doctor active holds counter in Redis against PostgreSQL ground truth.
   * Ensures counter never drifts, goes negative, or includes expired holds.
   */
  async reconcileDoctorCounter(
    clinicId: string,
    doctorId: string,
    now = new Date(),
  ): Promise<number> {
    const counterKey = this.getCounterKey(clinicId, doctorId);
    const count = await this.prisma.appointment.count({
      where: {
        clinicId,
        doctorId,
        status: AppointmentStatus.SOLICITADA,
        holdExpiresAt: {
          gt: now,
        },
      },
    });
    await this.redisService.set(counterKey, String(count));
    return count;
  }

  /**
   * Lazy check (Verificación perezosa):
   * Evaluates if status === 'SOLICITADA' && holdExpiresAt < NOW().
   * If expired, atomically transitions status to 'EXPIRADA', releases Redis slot,
   * and reconciles doctor counter.
   * (RF-025, CU-001, Guía §17)
   */
  async checkAndExpireAppointment(
    appointmentId: string,
    options?: SweepOptions,
  ): Promise<Appointment> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new NotFoundException(
        `Appointment with id ${appointmentId} not found`,
      );
    }

    const now = options?.nowOverride || new Date();

    if (
      appointment.status === AppointmentStatus.SOLICITADA &&
      appointment.holdExpiresAt &&
      appointment.holdExpiresAt < now
    ) {
      const updated = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.EXPIRADA },
      });

      const startAtIso = appointment.startAt.toISOString();
      const slotKey = this.getSlotKey(
        appointment.clinicId,
        appointment.doctorId,
        startAtIso,
      );

      await this.redisService.del(slotKey);
      await this.reconcileDoctorCounter(
        appointment.clinicId,
        appointment.doctorId,
        now,
      );

      this.logger.log(
        `Appointment ${appointmentId} lazy expired and Redis slot released`,
        'ExpirationService',
        {
          appointmentId,
          clinicId: appointment.clinicId,
          doctorId: appointment.doctorId,
          holdExpiresAt: appointment.holdExpiresAt.toISOString(),
          expiredAt: now.toISOString(),
        },
      );

      return updated;
    }

    return appointment;
  }

  /**
   * Periodic Sweeper (Barrido Periódico):
   * Searches all appointments with status === 'SOLICITADA' and holdExpiresAt <= NOW().
   * Transitions them to 'EXPIRADA' in transaction, records a ScheduledJob with
   * idempotencyKey 'expiracion_hold:${clinicId}:${appointmentId}:${dateStr}',
   * releases slots in Redis, and reconciles doctor counters.
   * (RF-025, RNF-011, Guía §17)
   */
  async sweepExpiredHolds(
    clinicId?: string,
    options?: SweepOptions,
  ): Promise<SweepResult> {
    const now = options?.nowOverride || new Date();
    const dateStr = now.toISOString().split('T')[0];

    const whereClause: any = {
      status: AppointmentStatus.SOLICITADA,
      holdExpiresAt: {
        lte: now,
      },
    };

    if (clinicId) {
      whereClause.clinicId = clinicId;
    }

    const expiredAppointments = await this.prisma.appointment.findMany({
      // bypass-tenant-check: system-level sweeper sweeps expired holds across clinics or filtered by clinicId
      where: whereClause,
      select: {
        id: true,
        clinicId: true,
        doctorId: true,
        startAt: true,
        endAt: true,
        holdExpiresAt: true,
      },
    });

    let expiredCount = 0;
    const processedJobIds: string[] = [];
    const affectedDoctors = new Set<string>();

    for (const appt of expiredAppointments) {
      const idempotencyKey = `expiracion_hold:${appt.clinicId}:${appt.id}:${dateStr}`;

      const scheduledJob = await this.prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: appt.id },
          data: { status: AppointmentStatus.EXPIRADA },
        });

        return tx.scheduledJob.upsert({
          where: { idempotencyKey },
          update: {
            status: JobStatus.COMPLETED,
            attempts: { increment: 1 },
            updatedAt: now,
          },
          create: {
            clinicId: appt.clinicId,
            type: 'expiracion_hold',
            entityId: appt.id,
            executionDate: dateStr,
            status: JobStatus.COMPLETED,
            idempotencyKey,
            attempts: 1,
            payload: {
              expiredAt: now.toISOString(),
              doctorId: appt.doctorId,
              startAt: appt.startAt.toISOString(),
              holdExpiresAt: appt.holdExpiresAt?.toISOString(),
            },
          },
        });
      });

      const startAtIso = appt.startAt.toISOString();
      const slotKey = this.getSlotKey(
        appt.clinicId,
        appt.doctorId,
        startAtIso,
      );
      await this.redisService.del(slotKey);

      affectedDoctors.add(`${appt.clinicId}:${appt.doctorId}`);
      processedJobIds.push(scheduledJob.id);
      expiredCount++;
    }

    // Reconcile hold counters for all doctors affected by the sweep
    for (const item of affectedDoctors) {
      const [cId, dId] = item.split(':');
      await this.reconcileDoctorCounter(cId, dId, now);
    }

    if (expiredCount > 0) {
      this.logger.log(
        `Sweep expired holds finished: ${expiredCount} holds expired and cleaned`,
        'ExpirationService',
        {
          expiredCount,
          clinicId: clinicId || 'ALL',
          dateStr,
        },
      );
    }

    return { expiredCount, processedJobIds };
  }
}
