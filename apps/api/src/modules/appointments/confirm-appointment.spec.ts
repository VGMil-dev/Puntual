import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AppointmentStatus, JobStatus } from '@prisma/client';
import {
  AppointmentsService,
  ConfirmAppointmentResult,
} from './appointments.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HoldService } from '../holds/hold.service';
import { CALENDAR_PORT, CalendarPort } from '../calendar/ports/calendar.port';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { ConfirmAppointmentDto } from './dto/confirm-appointment.dto';

describe('ConfirmAppointment Use Case (E2.3 / CU-001 pasos 5-6 / RF-010 / RF-024 / RNF-006 / RNF-010 / RNF-011)', () => {
  let service: AppointmentsService;
  let prismaMock: any;
  let holdServiceMock: any;
  let calendarPortMock: jest.Mocked<CalendarPort>;
  let loggerMock: any;

  // In-memory relational database state for tests
  let appointmentsDb: Map<string, any>;
  let scheduledJobsDb: Map<string, any>;

  const clinicAId = 'clinic-uuid-aaaa-1111';
  const clinicBId = 'clinic-uuid-bbbb-2222';
  const doctorAId = 'doctor-uuid-aaaa-1111';
  const patientAId = 'patient-uuid-aaaa-1111';
  const conversationAId = 'conv-whatsapp-12345';
  const conversationBId = 'conv-whatsapp-67890';
  const traceId = 'trace-test-12345';

  const mockDoctor = {
    id: doctorAId,
    clinicId: clinicAId,
    name: 'Roberto Gómez',
    googleCalendarId: 'doctor.roberto@gmail.com',
    googleRefreshTokenCipher: 'cipher:refresh-token-encrypted-abc',
  };

  const mockPatient = {
    id: patientAId,
    clinicId: clinicAId,
    name: 'Carlos Mendoza',
    phone: '+593991234567',
  };

  const mockClinic = {
    id: clinicAId,
    name: 'Clínica Dental del Valle',
    slug: 'dental-valle',
  };

  beforeEach(async () => {
    appointmentsDb = new Map<string, any>();
    scheduledJobsDb = new Map<string, any>();

    // Mock CalendarPort
    calendarPortMock = {
      createEvent: jest.fn().mockResolvedValue('gcal-event-999888'),
      updateEvent: jest.fn().mockResolvedValue(undefined),
      deleteEvent: jest.fn().mockResolvedValue(undefined),
      generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth'),
      exchangeCodeForTokens: jest.fn().mockResolvedValue({ refreshToken: 'mock-refresh-token' }),
      verifyWritePermissions: jest.fn().mockResolvedValue(true),
    };

    // Mock HoldService
    holdServiceMock = {
      releaseHold: jest.fn().mockResolvedValue({
        released: true,
        slotKey: 'hold:slot:mock',
        counterKey: 'hold:count:mock',
      }),
      acquireHold: jest.fn(),
      getDoctorHoldCount: jest.fn().mockResolvedValue(1),
      getHold: jest.fn().mockResolvedValue(conversationAId),
    };

    // Mock StructuredLoggerService
    loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    // Mock PrismaService simulating atomic transactions and scoped find/updates
    prismaMock = {
      appointment: {
        findFirst: jest.fn(async ({ where, include }: any) => {
          for (const appt of appointmentsDb.values()) {
            let match = true;
            if (where.id && appt.id !== where.id) match = false;
            if (where.clinicId && appt.clinicId !== where.clinicId) match = false;
            if (where.status && appt.status !== where.status) match = false;

            if (match) {
              const res = { ...appt };
              if (include?.doctor) res.doctor = appt.doctor || mockDoctor;
              if (include?.patient) res.patient = appt.patient || mockPatient;
              if (include?.clinic) res.clinic = appt.clinic || mockClinic;
              return res;
            }
          }
          return null;
        }),
        update: jest.fn(async ({ where, data, include }: any) => {
          const appt = appointmentsDb.get(where.id);
          if (!appt) {
            throw new Error(`Record to update not found: ${where.id}`);
          }
          const updated = {
            ...appt,
            ...data,
            updatedAt: data.updatedAt || new Date(),
          };
          appointmentsDb.set(where.id, updated);

          const res = { ...updated };
          if (include?.doctor) res.doctor = updated.doctor || mockDoctor;
          if (include?.patient) res.patient = updated.patient || mockPatient;
          if (include?.clinic) res.clinic = updated.clinic || mockClinic;
          return res;
        }),
      },
      scheduledJob: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const existing = scheduledJobsDb.get(where.idempotencyKey);
          if (existing) {
            const updated = {
              ...existing,
              ...update,
              updatedAt: new Date(),
            };
            scheduledJobsDb.set(where.idempotencyKey, updated);
            return updated;
          } else {
            const created = {
              id: `job-uuid-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              ...create,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            scheduledJobsDb.set(where.idempotencyKey, created);
            return created;
          }
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          return scheduledJobsDb.get(where.idempotencyKey) || null;
        }),
      },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => {
        return callback(prismaMock);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: HoldService, useValue: holdServiceMock },
        { provide: CALENDAR_PORT, useValue: calendarPortMock },
        { provide: StructuredLoggerService, useValue: loggerMock },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  // Helper to populate initial appointment
  function seedAppointment(overrides: Partial<any> = {}) {
    const defaultAppointment = {
      id: 'appointment-uuid-1111',
      clinicId: clinicAId,
      doctorId: doctorAId,
      patientId: patientAId,
      conversationId: conversationAId,
      status: AppointmentStatus.SOLICITADA,
      startAt: new Date('2026-10-20T15:00:00.000Z'),
      endAt: new Date('2026-10-20T15:30:00.000Z'),
      reason: 'Limpieza dental regular',
      googleCalendarEventId: null,
      holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // Valid for 10 more minutes
      doctor: { ...mockDoctor },
      patient: { ...mockPatient },
      clinic: { ...mockClinic },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const appt = { ...defaultAppointment, ...overrides };
    appointmentsDb.set(appt.id, appt);
    return appt;
  }

  describe('1. Successful Confirmation (CU-001 step 5, RF-010, RF-024, RNF-010)', () => {
    it('should successfully confirm an appointment, create Google Calendar event, and release Redis hold', async () => {
      const seeded = seedAppointment();

      const dto: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationAId,
        traceId,
      };

      const result = await service.confirmAppointment(dto);

      // Verify returned result
      expect(result.success).toBe(true);
      expect(result.appointmentId).toBe(seeded.id);
      expect(result.status).toBe(AppointmentStatus.CONFIRMADA);
      expect(result.calendarSyncStatus).toBe('SYNCED');
      expect(result.calendarEventId).toBe('gcal-event-999888');
      expect(result.isIdempotentReplay).toBe(false);
      expect(result.patientMessage).toContain('¡Tu cita ha sido confirmada con éxito!');
      expect(result.patientMessage).toContain('Roberto Gómez');

      // Verify PostgreSQL state
      const updatedInDb = appointmentsDb.get(seeded.id);
      expect(updatedInDb.status).toBe(AppointmentStatus.CONFIRMADA);
      expect(updatedInDb.googleCalendarEventId).toBe('gcal-event-999888');
      expect(updatedInDb.conversationId).toBe(conversationAId);

      // Verify CalendarPort was invoked with exact appointment details
      expect(calendarPortMock.createEvent).toHaveBeenCalledTimes(1);
      expect(calendarPortMock.createEvent).toHaveBeenCalledWith({
        calendarId: mockDoctor.googleCalendarId,
        refreshTokenCipher: mockDoctor.googleRefreshTokenCipher,
        summary: expect.stringContaining('Carlos Mendoza'),
        description: expect.stringContaining('Carlos Mendoza'),
        startAt: seeded.startAt,
        endAt: seeded.endAt,
      });

      // Verify Redis hold was released
      expect(holdServiceMock.releaseHold).toHaveBeenCalledTimes(1);
      expect(holdServiceMock.releaseHold).toHaveBeenCalledWith({
        clinicId: clinicAId,
        doctorId: doctorAId,
        startAt: seeded.startAt,
        conversationId: conversationAId,
        traceId,
        appointmentId: seeded.id,
      });

      // Verify structured logging
      expect(loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining('Google Calendar event created successfully'),
        'AppointmentsService',
        expect.objectContaining({
          appointmentId: seeded.id,
          doctorId: doctorAId,
          calendarEventId: 'gcal-event-999888',
        }),
      );
    });
  });

  describe('2. Idempotency (RNF-011)', () => {
    it('should return prior confirmation on second call with same appointmentId and conversationId without duplicate Calendar or Redis calls', async () => {
      const seeded = seedAppointment();

      const dto: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationAId,
        traceId,
      };

      // First confirmation call
      const firstResult = await service.confirmAppointment(dto);
      expect(firstResult.success).toBe(true);
      expect(firstResult.isIdempotentReplay).toBe(false);
      expect(calendarPortMock.createEvent).toHaveBeenCalledTimes(1);
      expect(holdServiceMock.releaseHold).toHaveBeenCalledTimes(1);

      // Second confirmation call (idempotent re-entry)
      const secondResult = await service.confirmAppointment(dto);

      expect(secondResult.success).toBe(true);
      expect(secondResult.appointmentId).toBe(seeded.id);
      expect(secondResult.status).toBe(AppointmentStatus.CONFIRMADA);
      expect(secondResult.calendarSyncStatus).toBe('SYNCED');
      expect(secondResult.calendarEventId).toBe('gcal-event-999888');
      expect(secondResult.isIdempotentReplay).toBe(true);
      expect(secondResult.patientMessage).toContain('¡Tu cita ha sido confirmada con éxito!');

      // Critical RNF-011 assertion: CalendarPort and HoldService must NOT be called again
      expect(calendarPortMock.createEvent).toHaveBeenCalledTimes(1);
      expect(holdServiceMock.releaseHold).toHaveBeenCalledTimes(1);

      // Verify structured logging for idempotent replay
      expect(loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining('Idempotent confirmation replay'),
        'AppointmentsService',
        expect.objectContaining({
          appointmentId: seeded.id,
          conversationId: conversationAId,
        }),
      );
    });

    it('should reject confirmation if appointment was already confirmed by a different conversationId', async () => {
      const seeded = seedAppointment({
        status: AppointmentStatus.CONFIRMADA,
        conversationId: conversationAId,
        googleCalendarEventId: 'gcal-existing',
      });

      const dtoWithDifferentConv: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationBId, // Different conversation!
        traceId,
      };

      await expect(service.confirmAppointment(dtoWithDifferentConv)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirmAppointment(dtoWithDifferentConv)).rejects.toThrow(
        'La cita ya fue confirmada previamente por otra conversación',
      );

      // Calendar and Redis must not be touched
      expect(calendarPortMock.createEvent).not.toHaveBeenCalled();
      expect(holdServiceMock.releaseHold).not.toHaveBeenCalled();
    });
  });

  describe('3. Expired Hold Rejection (CU-001 step 6, RF-025)', () => {
    it('should reject confirmation if hold has expired (holdExpiresAt < NOW()) and transition appointment to EXPIRADA', async () => {
      const expiredTime = new Date(Date.now() - 30 * 1000); // 30 seconds ago
      const seeded = seedAppointment({
        holdExpiresAt: expiredTime,
      });

      const dto: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationAId,
        traceId,
      };

      await expect(service.confirmAppointment(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirmAppointment(dto)).rejects.toThrow(
        'El tiempo de reserva ha expirado',
      );

      // Status in DB must transition to EXPIRADA
      const updatedInDb = appointmentsDb.get(seeded.id);
      expect(updatedInDb.status).toBe(AppointmentStatus.EXPIRADA);

      // CalendarPort must NOT be called
      expect(calendarPortMock.createEvent).not.toHaveBeenCalled();
    });

    it('should reject confirmation if appointment was already in EXPIRADA status', async () => {
      const seeded = seedAppointment({
        status: AppointmentStatus.EXPIRADA,
        holdExpiresAt: new Date(Date.now() - 60000),
      });

      const dto: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationAId,
      };

      await expect(service.confirmAppointment(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirmAppointment(dto)).rejects.toThrow(
        'El tiempo de reserva ha expirado',
      );

      expect(calendarPortMock.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('4. Multi-Tenant Isolation Boundary (RNF-001)', () => {
    it('should reject confirmation with NotFoundException if appointment belongs to another clinic', async () => {
      // Seed appointment in clinic A
      const seeded = seedAppointment({
        clinicId: clinicAId,
      });

      // Attempt to confirm passing clinic B
      const dtoOtherClinic: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicBId, // Cross-tenant boundary violation!
        conversationId: conversationAId,
        traceId,
      };

      await expect(service.confirmAppointment(dtoOtherClinic)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.confirmAppointment(dtoOtherClinic)).rejects.toThrow(
        `Cita con id ${seeded.id} no encontrada en la clínica especificada`,
      );

      // Verify appointment was untouched in DB
      const apptInDb = appointmentsDb.get(seeded.id);
      expect(apptInDb.status).toBe(AppointmentStatus.SOLICITADA);

      // Neither CalendarPort nor HoldService may be touched
      expect(calendarPortMock.createEvent).not.toHaveBeenCalled();
      expect(holdServiceMock.releaseHold).not.toHaveBeenCalled();
    });
  });

  describe('5. Partial Failure Handling (RNF-006 / RF-010 / RF-024)', () => {
    it('should keep appointment CONFIRMADA, enqueue ScheduledJob, and return confirmation to patient when CalendarPort fails', async () => {
      const seeded = seedAppointment();

      // Simulate transient Google Calendar 503 error / network failure
      const calendarError = new Error('Google Calendar 503 Service Unavailable: Backend Error');
      calendarPortMock.createEvent.mockRejectedValueOnce(calendarError);

      const dto: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationAId,
        traceId,
      };

      const result = await service.confirmAppointment(dto);

      // 1. Postgres transaction must NOT be rolled back; appointment remains CONFIRMADA
      expect(result.success).toBe(true);
      expect(result.appointmentId).toBe(seeded.id);
      expect(result.status).toBe(AppointmentStatus.CONFIRMADA);
      expect(result.calendarSyncStatus).toBe('PENDING');
      expect(result.calendarEventId).toBeNull();
      expect(result.scheduledJobId).toBeDefined();

      const apptInDb = appointmentsDb.get(seeded.id);
      expect(apptInDb.status).toBe(AppointmentStatus.CONFIRMADA);

      // 2. Patient must NOT receive an error; receives standard confirmation message (RF-024)
      expect(result.patientMessage).toContain('¡Tu cita ha sido confirmada con éxito!');
      expect(result.patientMessage).toContain('Roberto Gómez');

      // 3. Redis hold must be released
      expect(holdServiceMock.releaseHold).toHaveBeenCalledTimes(1);

      // 4. ScheduledJob must be enqueued with exact idempotencyKey and payload
      const expectedIdempotencyKey = `calendar_sync:${clinicAId}:${seeded.id}:intento1`;
      const job = scheduledJobsDb.get(expectedIdempotencyKey);

      expect(job).toBeDefined();
      expect(job.type).toBe('calendar_sync');
      expect(job.entityId).toBe(seeded.id);
      expect(job.clinicId).toBe(clinicAId);
      expect(job.status).toBe(JobStatus.PENDING);
      expect(job.idempotencyKey).toBe(expectedIdempotencyKey);
      expect(job.attempts).toBe(1);
      expect(job.lastError).toContain('Google Calendar 503 Service Unavailable');
      expect(job.payload).toEqual(
        expect.objectContaining({
          doctorId: doctorAId,
          calendarId: mockDoctor.googleCalendarId,
          startAt: seeded.startAt.toISOString(),
          endAt: seeded.endAt.toISOString(),
        }),
      );

      // 5. Structured warning log must be emitted
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('CalendarSyncFailed (CalendarSyncError)'),
        'AppointmentsService',
        expect.objectContaining({
          traceId,
          clinicId: clinicAId,
          doctorId: doctorAId,
          appointmentId: seeded.id,
          errorMessage: calendarError.message,
          idempotencyKey: expectedIdempotencyKey,
        }),
      );
    });

    it('should categorize CalendarAuthorizationError when token is invalid or revoked', async () => {
      const seeded = seedAppointment();

      const authError = new Error('invalid_grant: Token has been expired or revoked');
      calendarPortMock.createEvent.mockRejectedValueOnce(authError);

      const dto: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationAId,
        traceId,
      };

      const result = await service.confirmAppointment(dto);

      expect(result.success).toBe(true);
      expect(result.status).toBe(AppointmentStatus.CONFIRMADA);
      expect(result.calendarSyncStatus).toBe('PENDING');

      // Check log category was classified as CalendarAuthorizationError
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('CalendarSyncFailed (CalendarAuthorizationError)'),
        'AppointmentsService',
        expect.objectContaining({
          appointmentId: seeded.id,
          errorCategory: 'CalendarAuthorizationError',
        }),
      );
    });
  });

  describe('6. Doctor without Google Calendar Credentials', () => {
    it('should confirm appointment and skip Calendar sync when doctor has no configured credentials', async () => {
      const doctorNoCal = {
        ...mockDoctor,
        googleCalendarId: null,
        googleRefreshTokenCipher: null,
      };

      const seeded = seedAppointment({
        doctor: doctorNoCal,
      });

      const dto: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationAId,
        traceId,
      };

      const result = await service.confirmAppointment(dto);

      expect(result.success).toBe(true);
      expect(result.status).toBe(AppointmentStatus.CONFIRMADA);
      expect(result.calendarSyncStatus).toBe('SKIPPED');
      expect(result.calendarEventId).toBeNull();
      expect(result.patientMessage).toContain('¡Tu cita ha sido confirmada con éxito!');

      // CalendarPort must NOT be called
      expect(calendarPortMock.createEvent).not.toHaveBeenCalled();

      // Hold must still be released
      expect(holdServiceMock.releaseHold).toHaveBeenCalledTimes(1);

      // Structured info logged
      expect(loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining('Google Calendar sync skipped'),
        'AppointmentsService',
        expect.objectContaining({
          clinicId: clinicAId,
          appointmentId: seeded.id,
        }),
      );
    });
  });

  describe('7. Invalid Appointment Status Rejection', () => {
    it('should reject confirmation if appointment is CANCELADA', async () => {
      const seeded = seedAppointment({
        status: AppointmentStatus.CANCELADA,
      });

      const dto: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationAId,
      };

      await expect(service.confirmAppointment(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirmAppointment(dto)).rejects.toThrow(
        'La cita ha sido cancelada',
      );

      expect(calendarPortMock.createEvent).not.toHaveBeenCalled();
    });

    it('should reject confirmation if appointment in SOLICITADA does not belong to conversationId', async () => {
      const seeded = seedAppointment({
        conversationId: conversationAId,
      });

      const dto: ConfirmAppointmentDto = {
        appointmentId: seeded.id,
        clinicId: clinicAId,
        conversationId: conversationBId, // Mismatched conversation
      };

      await expect(service.confirmAppointment(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirmAppointment(dto)).rejects.toThrow(
        'La cita no corresponde a la conversación actual',
      );

      expect(calendarPortMock.createEvent).not.toHaveBeenCalled();
      expect(holdServiceMock.releaseHold).not.toHaveBeenCalled();
    });
  });
});
