import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { AppointmentStatus, JobStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HoldService } from '../holds/hold.service';
import { AvailabilityService } from '../availability/availability.service';
import { CALENDAR_PORT, CalendarPort } from '../calendar/ports/calendar.port';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { ConfirmAppointmentDto } from './dto/confirm-appointment.dto';
import { BookAppointmentDto } from './dto/book-appointment.dto';

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

export interface BookAppointmentOptions {
  nowOverride?: Date;
}

export interface BookAppointmentResult {
  appointment: any;
  isIdempotentReplay: boolean;
  status: AppointmentStatus;
}

/**
 * AppointmentsService: Handles booking (hold acquisition + Postgres creation) and confirmation (CU-001 steps 4-6).
 * Enforces atomic Postgres transactions, multi-tenant boundaries (RNF-001), Redis hold releases/compensation (RF-025),
 * CalendarPort abstraction (RNF-010), idempotent re-entries (RNF-011), partial failure tolerance (RNF-006),
 * and WhatsApp 24h direct window compliance (RF-024).
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holdService: HoldService,
    private readonly availabilityService: AvailabilityService,
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
            existing.conversationId === dto.conversationId;

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
        const idempotencyKey = `calendar_sync:${appointment.clinicId}:${appointment.id}`;
        const firstRetryAt = new Date(now.getTime() + 60 * 1000); // Backoff inicial: 1 minuto (Decisión D9 / RNF-006)

        const job = await this.prisma.scheduledJob.upsert({
          where: { idempotencyKey },
          update: {
            attempts: { increment: 1 },
            nextRetryAt: firstRetryAt,
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
            nextRetryAt: firstRetryAt,
            payload: {
              doctorId: doctor.id,
              calendarId: doctor.googleCalendarId,
              refreshTokenCipher: doctor.googleRefreshTokenCipher,
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

  /**
   * Books an appointment with atomic distributed hold (Ticket E2.2b-bis / CU-001 step 4 / RF-025 / RF-029 / RNF-001 / RNF-011).
   * 1. Validates tenant scoping: clinic, doctor, and patient existence.
   * 2. Strict idempotency pre-check (RNF-011): returns existing appointment if already SOLICITADA (active) or CONFIRMADA.
   * 3. Validates real-time availability using AvailabilityService (RF-029 hierarchy and slot checking).
   * 4. Acquires atomic hold in Redis via HoldService.acquireHold (CU-001 Alt Flow C).
   * 5. Creates Appointment in Postgres (status: SOLICITADA, holdExpiresAt: now + ttl).
   * 6. Mandatory compensation: if Postgres creation fails after acquiring hold, releases hold immediately.
   * 7. Structured logging with traceId, clinicId, doctorId, conversationId, appointmentId.
   */
  async bookAppointment(
    dto: BookAppointmentDto,
    options?: BookAppointmentOptions,
  ): Promise<BookAppointmentResult> {
    const now = options?.nowOverride || new Date();

    // -------------------------------------------------------------------------
    // Step 1: Validate date and time
    // -------------------------------------------------------------------------
    const startAtDate = new Date(dto.startAt);
    if (isNaN(startAtDate.getTime())) {
      throw new BadRequestException('Formato de fecha inválido para startAt');
    }

    if (startAtDate.getTime() <= now.getTime()) {
      throw new BadRequestException('El horario seleccionado está en el pasado');
    }

    // -------------------------------------------------------------------------
    // Step 2: Validate multi-tenant boundaries (RNF-001)
    // -------------------------------------------------------------------------
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: dto.clinicId },
    });
    if (!clinic) {
      throw new NotFoundException(`Clínica con id ${dto.clinicId} no encontrada`);
    }

    const doctor = await this.prisma.doctor.findFirst({
      where: {
        clinicId: dto.clinicId,
        id: dto.doctorId,
      },
    });
    if (!doctor) {
      throw new NotFoundException(
        `Doctor con id ${dto.doctorId} no encontrado en la clínica especificada`,
      );
    }

    const patient = await this.prisma.patient.findFirst({
      where: {
        clinicId: dto.clinicId,
        id: dto.patientId,
      },
    });
    if (!patient) {
      throw new NotFoundException(
        `Paciente con id ${dto.patientId} no encontrado en la clínica especificada`,
      );
    }

    // -------------------------------------------------------------------------
    // Step 3: Strict Idempotency Check (RNF-011)
    // Same conversationId + doctorId + clinicId + startAt
    // -------------------------------------------------------------------------
    const existing = await this.prisma.appointment.findFirst({
      where: {
        clinicId: dto.clinicId,
        doctorId: dto.doctorId,
        conversationId: dto.conversationId,
        startAt: startAtDate,
        status: {
          in: [AppointmentStatus.SOLICITADA, AppointmentStatus.CONFIRMADA],
        },
      },
      include: {
        doctor: true,
        patient: true,
        clinic: true,
      },
    });

    if (existing) {
      if (existing.status === AppointmentStatus.CONFIRMADA) {
        this.logger.log(
          `Idempotent book replay (CONFIRMADA) for appointment ${existing.id} from conversation ${dto.conversationId}`,
          'AppointmentsService',
          {
            traceId: dto.traceId,
            clinicId: dto.clinicId,
            doctorId: dto.doctorId,
            conversationId: dto.conversationId,
            appointmentId: existing.id,
          },
        );
        return {
          appointment: existing,
          isIdempotentReplay: true,
          status: existing.status,
        };
      }

      if (
        existing.status === AppointmentStatus.SOLICITADA &&
        existing.holdExpiresAt &&
        existing.holdExpiresAt.getTime() > now.getTime()
      ) {
        this.logger.log(
          `Idempotent book replay (SOLICITADA active hold) for appointment ${existing.id} from conversation ${dto.conversationId}`,
          'AppointmentsService',
          {
            traceId: dto.traceId,
            clinicId: dto.clinicId,
            doctorId: dto.doctorId,
            conversationId: dto.conversationId,
            appointmentId: existing.id,
          },
        );
        return {
          appointment: existing,
          isIdempotentReplay: true,
          status: existing.status,
        };
      }
    }

    // -------------------------------------------------------------------------
    // Step 4: Validate real-time availability via AvailabilityService (RF-029)
    // -------------------------------------------------------------------------
    const dayAvailability = await this.availabilityService.getAvailabilityForDate(
      dto.clinicId,
      dto.doctorId,
      dto.startAt,
      {
        specialtyId: dto.specialtyId,
        motivo: dto.motivo,
        conversationId: dto.conversationId,
        now,
      },
    );

    const matchingSlot = dayAvailability?.slots?.find(
      (slot) => new Date(slot.startAt).getTime() === startAtDate.getTime(),
    );

    if (!matchingSlot) {
      throw new ConflictException(
        'El horario seleccionado no se encuentra disponible para el doctor especificado',
      );
    }

    const endAtDate = new Date(matchingSlot.endAt);

    // -------------------------------------------------------------------------
    // Step 5: Acquire atomic Redis hold via HoldService (CU-001 Alt Flow C)
    // -------------------------------------------------------------------------
    const ttl = dto.ttlSeconds && dto.ttlSeconds > 0 ? dto.ttlSeconds : 900;

    const holdResult = await this.holdService.acquireHold({
      clinicId: dto.clinicId,
      doctorId: dto.doctorId,
      startAt: startAtDate,
      conversationId: dto.conversationId,
      ttlSeconds: ttl,
      traceId: dto.traceId,
    });

    if (!holdResult.success) {
      if (holdResult.reason === 'MAX_HOLDS_EXCEEDED') {
        throw new ConflictException(
          'El doctor ha alcanzado el límite máximo de reservas concurrentes simultáneas',
        );
      }
      if (holdResult.reason === 'SLOT_ALREADY_LOCKED') {
        // Check if the slot was locked by this conversation (concurrent idempotent replay)
        const currentHold = await this.holdService.getHold(
          dto.clinicId,
          dto.doctorId,
          startAtDate,
        );

        const holdOwner = typeof currentHold === 'string' ? currentHold : (currentHold as any)?.conversationId;
        if (holdOwner === dto.conversationId) {
          // Wait briefly for Postgres write from the winning concurrent worker if needed
          let attempts = 0;
          while (attempts < 10) {
            const existingConcurrent = await this.prisma.appointment.findFirst({
              where: {
                clinicId: dto.clinicId,
                doctorId: dto.doctorId,
                conversationId: dto.conversationId,
                startAt: startAtDate,
                status: {
                  in: [AppointmentStatus.SOLICITADA, AppointmentStatus.CONFIRMADA],
                },
              },
              include: {
                doctor: true,
                patient: true,
                clinic: true,
              },
            });

            if (existingConcurrent) {
              this.logger.log(
                `Idempotent concurrent book replay for appointment ${existingConcurrent.id}`,
                'AppointmentsService',
                {
                  traceId: dto.traceId,
                  clinicId: dto.clinicId,
                  doctorId: dto.doctorId,
                  conversationId: dto.conversationId,
                  appointmentId: existingConcurrent.id,
                },
              );
              return {
                appointment: existingConcurrent,
                isIdempotentReplay: true,
                status: existingConcurrent.status,
              };
            }
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 15));
          }
        }

        throw new ConflictException(
          'El horario seleccionado ya se encuentra temporalmente bloqueado por otra solicitud',
        );
      }
      throw new ConflictException(
        `No fue posible adquirir el bloqueo temporal del horario: ${holdResult.reason}`,
      );
    }

    // -------------------------------------------------------------------------
    // Step 6: Create Appointment in Postgres with mandatory compensation
    // -------------------------------------------------------------------------
    const holdExpiresAt =
      holdResult.expiresAt || new Date(now.getTime() + ttl * 1000);

    let appointment;
    try {
      appointment = await this.prisma.appointment.create({
        data: {
          clinicId: dto.clinicId,
          doctorId: dto.doctorId,
          patientId: dto.patientId,
          conversationId: dto.conversationId,
          status: AppointmentStatus.SOLICITADA,
          startAt: startAtDate,
          endAt: endAtDate,
          reason: dto.motivo,
          holdExpiresAt,
        },
        include: {
          doctor: true,
          patient: true,
          clinic: true,
        },
      });
    } catch (dbError: any) {
      this.logger.error(
        `Postgres appointment creation failed after acquiring hold. Executing compensating releaseHold...`,
        dbError?.stack,
        'AppointmentsService',
        {
          traceId: dto.traceId,
          clinicId: dto.clinicId,
          doctorId: dto.doctorId,
          conversationId: dto.conversationId,
          startAt: startAtDate.toISOString(),
          errorMessage: dbError?.message,
        },
      );

      // Mandatory compensation: release Redis hold
      try {
        await this.holdService.releaseHold({
          clinicId: dto.clinicId,
          doctorId: dto.doctorId,
          startAt: startAtDate,
          conversationId: dto.conversationId,
          traceId: dto.traceId,
        });
      } catch (compensationError: any) {
        this.logger.error(
          `Compensation releaseHold failed after Postgres create error`,
          compensationError?.stack,
          'AppointmentsService',
          {
            traceId: dto.traceId,
            clinicId: dto.clinicId,
            doctorId: dto.doctorId,
            conversationId: dto.conversationId,
          },
        );
      }

      throw dbError;
    }

    // -------------------------------------------------------------------------
    // Step 7: Structured logging and return
    // -------------------------------------------------------------------------
    this.logger.log(
      `Appointment booked successfully with hold (status SOLICITADA) for doctor ${dto.doctorId} and patient ${dto.patientId}`,
      'AppointmentsService',
      {
        traceId: dto.traceId,
        clinicId: dto.clinicId,
        doctorId: dto.doctorId,
        patientId: dto.patientId,
        conversationId: dto.conversationId,
        appointmentId: appointment.id,
        startAt: appointment.startAt.toISOString(),
        endAt: appointment.endAt.toISOString(),
        holdExpiresAt: holdExpiresAt.toISOString(),
      },
    );

    return {
      appointment,
      isIdempotentReplay: false,
      status: appointment.status,
    };
  }
}
