import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AppointmentStatus, JobStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HoldService } from '../holds/hold.service';
import { CALENDAR_PORT, CalendarPort } from '../calendar/ports/calendar.port';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { ConfirmAppointmentDto } from './dto/confirm-appointment.dto';

export interface ConfirmAppointmentOptions {
  nowOverride?: Date;
}

export interface ConfirmAppointmentResult {
  success: boolean;
  appointmentId: string;
  status: AppointmentStatus;
  calendarSyncStatus: 'SYNCED' | 'PENDING' | 'SKIPPED';
  calendarEventId?: string | null;
  scheduledJobId?: string | null;
  patientMessage: string;
  isIdempotentReplay?: boolean;
}

/**
 * AppointmentsService: Handles confirmation, notification, and Google Calendar sync (CU-001 steps 5-6).
 * Enforces atomic Postgres transactions, multi-tenant boundaries (RNF-001), Redis hold releases (RF-025),
 * CalendarPort abstraction (RNF-010), idempotent re-entries (RNF-011), partial failure tolerance (RNF-006),
 * and WhatsApp 24h direct window compliance (RF-024).
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holdService: HoldService,
    @Inject(CALENDAR_PORT) private readonly calendarPort: CalendarPort,
    private readonly logger: StructuredLoggerService,
  ) {}

  /**
   * Formats patient direct response confirmation message within WhatsApp 24h window (RF-024).
   * Does not require Meta template because it responds directly to recent patient confirmation interaction.
   */
  buildConfirmationMessage(appointment: any): string {
    const doctorName = appointment.doctor?.name
      ? `el Dr. ${appointment.doctor.name}`
      : 'nuestro especialista';
    const startAt = new Date(appointment.startAt);

    // Format ISO date and time
    const dateStr = startAt.toISOString().split('T')[0];
    const timeStr = startAt.toISOString().split('T')[1].substring(0, 5);

    return `¡Tu cita ha sido confirmada con éxito! Te esperamos el ${dateStr} a las ${timeStr} con ${doctorName}.`;
  }

  /**
   * Confirms a held appointment (CU-001 step 5, RF-010, RF-024, RNF-006, RNF-010, RNF-011).
   */
  async confirmAppointment(
    dto: ConfirmAppointmentDto,
    options?: ConfirmAppointmentOptions,
  ): Promise<ConfirmAppointmentResult> {
    const now = options?.nowOverride || new Date();

    // -------------------------------------------------------------------------
    // Step 1: Atomic PostgreSQL transaction
    // -------------------------------------------------------------------------
    const { appointment, isPriorConfirmation } = await this.prisma.$transaction(
      async (tx) => {
        // Find appointment scoped to clinicId (RNF-001 multi-tenant boundary)
        const existing = await tx.appointment.findFirst({
          where: {
            id: dto.appointmentId,
            clinicId: dto.clinicId,
          },
          include: {
            doctor: true,
            patient: true,
            clinic: true,
          },
        });

        if (!existing) {
          throw new NotFoundException(
            `Cita con id ${dto.appointmentId} no encontrada en la clínica especificada`,
          );
        }

        // Idempotency check (RNF-011): if already CONFIRMADA
        if (existing.status === AppointmentStatus.CONFIRMADA) {
          const isSameConversation =
            existing.conversationId === dto.conversationId ||
            existing.reason === dto.conversationId ||
            (Boolean(existing.reason) &&
              existing.reason!.includes(dto.conversationId));

          if (!isSameConversation) {
            throw new BadRequestException(
              'La cita ya fue confirmada previamente por otra conversación',
            );
          }

          return { appointment: existing, isPriorConfirmation: true };
        }

        // Check if hold already expired
        const isHoldExpired =
          !existing.holdExpiresAt || existing.holdExpiresAt.getTime() <= now.getTime();

        if (isHoldExpired || existing.status === AppointmentStatus.EXPIRADA) {
          if (existing.status !== AppointmentStatus.EXPIRADA) {
            await tx.appointment.update({
              where: { id: existing.id },
              data: {
                status: AppointmentStatus.EXPIRADA,
                updatedAt: now,
              },
            });
          }

          throw new BadRequestException('El tiempo de reserva ha expirado');
        }

        // Validate state is SOLICITADA
        if (existing.status !== AppointmentStatus.SOLICITADA) {
          if (existing.status === AppointmentStatus.CANCELADA) {
            throw new BadRequestException('La cita ha sido cancelada');
          }
          throw new BadRequestException(
            `La cita no se encuentra en estado para ser confirmada (${existing.status})`,
          );
        }

        // Validate conversationId ownership
        if (
          existing.conversationId &&
          existing.conversationId !== dto.conversationId
        ) {
          throw new BadRequestException(
            'La cita no corresponde a la conversación actual',
          );
        }

        // Atomically update status to CONFIRMADA
        const updated = await tx.appointment.update({
          where: { id: existing.id },
          data: {
            status: AppointmentStatus.CONFIRMADA,
            conversationId: dto.conversationId,
            updatedAt: now,
          },
          include: {
            doctor: true,
            patient: true,
            clinic: true,
          },
        });

        return { appointment: updated, isPriorConfirmation: false };
      },
    );

    // -------------------------------------------------------------------------
    // Step 2: Idempotent return if already confirmed
    // -------------------------------------------------------------------------
    if (isPriorConfirmation) {
      this.logger.log(
        `Idempotent confirmation replay for appointment ${appointment.id} from conversation ${dto.conversationId}`,
        'AppointmentsService',
        {
          traceId: dto.traceId,
          clinicId: dto.clinicId,
          appointmentId: appointment.id,
          conversationId: dto.conversationId,
        },
      );

      return {
        success: true,
        appointmentId: appointment.id,
        status: appointment.status,
        calendarSyncStatus: appointment.googleCalendarEventId
          ? 'SYNCED'
          : 'PENDING',
        calendarEventId: appointment.googleCalendarEventId,
        scheduledJobId: null,
        patientMessage: this.buildConfirmationMessage(appointment),
        isIdempotentReplay: true,
      };
    }

    // -------------------------------------------------------------------------
    // Step 3: Release Redis Hold & decrement doctor counter atomically (RF-025)
    // -------------------------------------------------------------------------
    try {
      await this.holdService.releaseHold({
        clinicId: appointment.clinicId,
        doctorId: appointment.doctorId,
        startAt: appointment.startAt,
        conversationId: dto.conversationId,
        traceId: dto.traceId,
        appointmentId: appointment.id,
      });
    } catch (redisErr: any) {
      this.logger.warn(
        `Failed to release hold in Redis for appointment ${appointment.id}: ${redisErr?.message}`,
        'AppointmentsService',
        {
          traceId: dto.traceId,
          clinicId: appointment.clinicId,
          appointmentId: appointment.id,
        },
      );
    }

    // -------------------------------------------------------------------------
    // Step 4: Google Calendar integration via CalendarPort (RNF-010, RF-010)
    // -------------------------------------------------------------------------
    const doctor = appointment.doctor;
    let calendarSyncStatus: 'SYNCED' | 'PENDING' | 'SKIPPED' = 'SKIPPED';
    let calendarEventId: string | null = null;
    let scheduledJobId: string | null = null;

    if (doctor?.googleCalendarId && doctor?.googleRefreshTokenCipher) {
      const patientName = appointment.patient?.name || 'Paciente';
      const patientPhone = appointment.patient?.phone || '';
      const summary = `Cita: ${patientName} - ${appointment.reason || 'Consulta médica'}`;
      const description = `Paciente: ${patientName}\nTeléfono: ${patientPhone}\nMotivo: ${appointment.reason || 'Consulta médica'}\nCita ID: ${appointment.id}\nCanal: WhatsApp`;

      try {
        calendarEventId = await this.calendarPort.createEvent({
          calendarId: doctor.googleCalendarId,
          refreshTokenCipher: doctor.googleRefreshTokenCipher,
          summary,
          description,
          startAt: appointment.startAt,
          endAt: appointment.endAt,
        });

        await this.prisma.appointment.update({
          where: { id: appointment.id },
          data: { googleCalendarEventId: calendarEventId },
        });

        calendarSyncStatus = 'SYNCED';

        this.logger.log(
          `Google Calendar event created successfully for appointment ${appointment.id} (RF-010)`,
          'AppointmentsService',
          {
            traceId: dto.traceId,
            clinicId: appointment.clinicId,
            doctorId: doctor.id,
            appointmentId: appointment.id,
            calendarEventId,
          },
        );
      } catch (calendarError: any) {
        // -----------------------------------------------------------------------
        // Step 5: Partial failure handling (RNF-006)
        // Keep appointment CONFIRMADA, do NOT revert, do NOT fail patient response.
        // Enqueue ScheduledJob with retry idempotency key and backoff metadata.
        // -----------------------------------------------------------------------
        calendarSyncStatus = 'PENDING';
        const executionDate = now.toISOString().split('T')[0];
        const idempotencyKey = `calendar_sync:${appointment.clinicId}:${appointment.id}:intento1`;

        const job = await this.prisma.scheduledJob.upsert({
          where: { idempotencyKey },
          update: {
            lastError: calendarError.message || String(calendarError),
            updatedAt: now,
          },
          create: {
            clinicId: appointment.clinicId,
            type: 'calendar_sync',
            entityId: appointment.id,
            executionDate,
            status: JobStatus.PENDING,
            idempotencyKey,
            attempts: 1,
            payload: {
              doctorId: doctor.id,
              calendarId: doctor.googleCalendarId,
              summary,
              description,
              startAt: appointment.startAt.toISOString(),
              endAt: appointment.endAt.toISOString(),
            },
            lastError: calendarError.message || String(calendarError),
          },
        });
        scheduledJobId = job.id;

        const isAuthError =
          calendarError.message?.toLowerCase().includes('token') ||
          calendarError.message?.toLowerCase().includes('auth') ||
          calendarError.message?.toLowerCase().includes('unauthorized') ||
          calendarError.message?.toLowerCase().includes('invalid_grant') ||
          calendarError.status === 401 ||
          calendarError.status === 403;

        const errorCategory = isAuthError
          ? 'CalendarAuthorizationError'
          : 'CalendarSyncError';

        this.logger.warn(
          `CalendarSyncFailed (${errorCategory}): Failed to create Google Calendar event for appointment ${appointment.id}. ScheduledJob enqueued for retry with backoff.`,
          'AppointmentsService',
          {
            traceId: dto.traceId,
            clinicId: appointment.clinicId,
            doctorId: doctor.id,
            appointmentId: appointment.id,
            errorCategory,
            errorMessage: calendarError.message,
            scheduledJobId: job.id,
            idempotencyKey,
          },
        );
      }
    } else {
      this.logger.log(
        `Google Calendar sync skipped: doctor ${doctor?.id || 'N/A'} has no configured calendar credentials`,
        'AppointmentsService',
        {
          traceId: dto.traceId,
          clinicId: appointment.clinicId,
          doctorId: doctor?.id,
          appointmentId: appointment.id,
        },
      );
    }

    // -------------------------------------------------------------------------
    // Step 6: Patient confirmation response (RF-024)
    // -------------------------------------------------------------------------
    const patientMessage = this.buildConfirmationMessage(appointment);

    return {
      success: true,
      appointmentId: appointment.id,
      status: AppointmentStatus.CONFIRMADA,
      calendarSyncStatus,
      calendarEventId,
      scheduledJobId,
      patientMessage,
      isIdempotentReplay: false,
    };
  }
}
