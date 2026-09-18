import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppointmentStatus, JobStatus } from '@prisma/client';
import { AppointmentsController } from '../src/modules/appointments/appointments.controller';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';
import { HoldService } from '../src/modules/holds/hold.service';
import { AvailabilityService } from '../src/modules/availability/availability.service';
import { CALENDAR_PORT } from '../src/modules/calendar/ports/calendar.port';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { StructuredLoggerService } from '../src/infrastructure/logging/structured-logger.service';

/**
 * ============================================================================
 * WALKING SKELETON INTEGRATION TEST: book → confirm (CU-001, RF-025, RF-029, RNF-011)
 *
 * Verifies the end-to-end flow:
 * 1. POST /internal/appointments/book:
 *    - Validates availability (AvailabilityService)
 *    - Acquires atomic Redis hold (HoldService)
 *    - Persists Appointment with status SOLICITADA (Postgres)
 * 2. Idempotent book re-entry:
 *    - Repeated book with same conversationId + doctorId + startAt returns 200 OK
 * 3. POST /internal/appointments/confirm:
 *    - Validates hold ownership & transitions Appointment to CONFIRMADA
 *    - Releases atomic Redis hold
 *    - Creates Google Calendar event via CALENDAR_PORT
 * 4. Idempotent confirm re-entry:
 *    - Repeated confirm returns 200 OK (isPriorConfirmation: true) without duplicating events
 * 5. Mismatched conversation rejection:
 *    - Another conversationId cannot claim or confirm the appointment
 * ============================================================================
 */
describe('Walking Skeleton Integration: book → confirm (CU-001 / E2.2b-bis / E2.3)', () => {
  let app: INestApplication;
  let redisStorage: Map<string, string>;
  let appointmentsDb: Map<string, any>;
  let scheduledJobsDb: Map<string, any>;
  let calendarPortMock: { createEvent: jest.Mock };

  const CLINIC_ID = '11111111-1111-4111-a111-111111111111';
  const DOCTOR_ID = '22222222-2222-4222-a222-222222222222';
  const PATIENT_ID = '44444444-4444-4444-a444-444444444441';
  const CONVERSATION_A = 'conv-walking-user-01';
  const CONVERSATION_B = 'conv-walking-user-02';
  const SLOT_START = '2026-10-05T09:00:00.000Z';
  const SLOT_END = '2026-10-05T09:30:00.000Z';

  beforeAll(async () => {
    redisStorage = new Map<string, string>();
    appointmentsDb = new Map<string, any>();
    scheduledJobsDb = new Map<string, any>();

    calendarPortMock = {
      createEvent: jest.fn().mockResolvedValue('gcal-event-walking-123'),
    };

    const redisServiceMock = {
      isHealthy: jest.fn().mockResolvedValue(true),
      get: jest.fn(async (key: string) => redisStorage.get(key) || null),
      set: jest.fn(async (key: string, value: string) => {
        redisStorage.set(key, value);
        return 'OK';
      }),
      del: jest.fn(async (key: string) => {
        const existed = redisStorage.delete(key);
        return existed ? 1 : 0;
      }),
      keys: jest.fn(async () => Array.from(redisStorage.keys())),
      eval: jest.fn(async (script: string, numKeys: number, ...args: any[]) => {
        const isAcquire = script.includes('currentHolds') || script.includes('MAX_HOLDS_EXCEEDED');
        const isRelease = script.includes('owner == ARGV[1]') || script.includes('RELEASED') || script.includes('owner');

        if (isAcquire) {
          const slotKey = args[0];
          const counterKey = args[1];
          const convId = args[2];
          const ttl = parseInt(args[3], 10);
          const maxHolds = parseInt(args[4], 10);

          const existingSlot = redisStorage.get(slotKey);
          if (existingSlot && existingSlot !== convId) {
            return [0, 'SLOT_ALREADY_LOCKED', 0];
          }

          const currentCount = parseInt(redisStorage.get(counterKey) || '0', 10);
          if (!existingSlot && currentCount >= maxHolds) {
            return [0, 'MAX_HOLDS_EXCEEDED', currentCount];
          }

          redisStorage.set(slotKey, convId);
          const newCount = existingSlot ? currentCount : currentCount + 1;
          redisStorage.set(counterKey, String(newCount));
          return [1, 'OK', newCount];
        }

        if (isRelease) {
          const slotKey = args[0];
          const counterKey = args[1];
          const convId = args[2];

          const currentHolder = redisStorage.get(slotKey);
          if (!currentHolder) {
            return [0, 'KEY_NOT_FOUND', 0];
          }
          if (currentHolder !== convId) {
            return [0, 'CONVERSATION_MISMATCH', 0];
          }

          redisStorage.delete(slotKey);
          const currentCount = parseInt(redisStorage.get(counterKey) || '1', 10);
          const newCount = Math.max(0, currentCount - 1);
          redisStorage.set(counterKey, String(newCount));
          return [1, 'RELEASED', newCount];
        }

        return [0, 'UNKNOWN', 0];
      }),
    };

    const prismaServiceMock = {
      clinic: {
        findUnique: jest.fn().mockImplementation(async ({ where }) => {
          if (where.id === CLINIC_ID) {
            return { id: CLINIC_ID, name: 'Clínica Dental Gavanti', maxConcurrentHolds: 5 };
          }
          return null;
        }),
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          if (where.id === CLINIC_ID) {
            return { id: CLINIC_ID, name: 'Clínica Dental Gavanti', maxConcurrentHolds: 5 };
          }
          return null;
        }),
      },
      doctor: {
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          if (where.id === DOCTOR_ID && where.clinicId === CLINIC_ID) {
            return {
              id: DOCTOR_ID,
              clinicId: CLINIC_ID,
              name: 'Dr. Roberto Gómez',
              googleCalendarId: 'doctor.gomez@gavanti.com',
              googleRefreshTokenCipher: 'cipher-token-xyz',
              maxConcurrentHolds: null,
            };
          }
          return null;
        }),
      },
      patient: {
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          if (where.id === PATIENT_ID && where.clinicId === CLINIC_ID) {
            return {
              id: PATIENT_ID,
              clinicId: CLINIC_ID,
              name: 'Carlos Mendoza',
              phone: '+593991234567',
            };
          }
          return null;
        }),
      },
      appointment: {
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          for (const appt of appointmentsDb.values()) {
            let match = true;
            if (where.id && appt.id !== where.id) match = false;
            if (where.clinicId && appt.clinicId !== where.clinicId) match = false;
            if (where.doctorId && appt.doctorId !== where.doctorId) match = false;
            if (where.conversationId && appt.conversationId !== where.conversationId) match = false;
            if (where.startAt && new Date(appt.startAt).getTime() !== new Date(where.startAt).getTime()) match = false;
            if (where.status?.in && !where.status.in.includes(appt.status)) match = false;
            if (where.status && typeof where.status === 'string' && appt.status !== where.status) match = false;
            if (match) {
              return {
                ...appt,
                doctor: { id: appt.doctorId, name: 'Dr. Roberto Gómez', googleCalendarId: 'doctor.gomez@gavanti.com', googleRefreshTokenCipher: 'cipher-token-xyz' },
                patient: { id: appt.patientId, name: 'Carlos Mendoza', phone: '+593991234567' },
                clinic: { id: appt.clinicId, name: 'Clínica Dental Gavanti' },
              };
            }
          }
          return null;
        }),
        create: jest.fn().mockImplementation(async ({ data }) => {
          const id = '33333333-3333-4333-a333-333333333331';
          const newAppt = {
            id,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          appointmentsDb.set(id, newAppt);
          return {
            ...newAppt,
            doctor: { id: newAppt.doctorId, name: 'Dr. Roberto Gómez', googleCalendarId: 'doctor.gomez@gavanti.com', googleRefreshTokenCipher: 'cipher-token-xyz' },
            patient: { id: newAppt.patientId, name: 'Carlos Mendoza', phone: '+593991234567' },
            clinic: { id: newAppt.clinicId, name: 'Clínica Dental Gavanti' },
          };
        }),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          const existing = appointmentsDb.get(where.id);
          if (!existing) throw new Error('Appointment not found');
          const updated = { ...existing, ...data, updatedAt: new Date() };
          appointmentsDb.set(where.id, updated);
          return {
            ...updated,
            doctor: { id: updated.doctorId, name: 'Dr. Roberto Gómez', googleCalendarId: 'doctor.gomez@gavanti.com', googleRefreshTokenCipher: 'cipher-token-xyz' },
            patient: { id: updated.patientId, name: 'Carlos Mendoza', phone: '+593991234567' },
            clinic: { id: updated.clinicId, name: 'Clínica Dental Gavanti' },
          };
        }),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
      scheduledJob: {
        upsert: jest.fn().mockImplementation(async ({ where, update, create }) => {
          const key = where.idempotencyKey;
          const existing = scheduledJobsDb.get(key);
          if (existing) {
            const updated = { ...existing, ...update };
            scheduledJobsDb.set(key, updated);
            return updated;
          }
          const created = { id: `job-${Date.now()}`, ...create };
          scheduledJobsDb.set(key, created);
          return created;
        }),
      },
      $transaction: jest.fn(async (cb: any) => {
        if (typeof cb === 'function') {
          return cb(prismaServiceMock);
        }
        return Promise.all(cb);
      }),
    };

    const availabilityServiceMock = {
      resolveSlotDuration: jest.fn().mockResolvedValue(30),
      getAvailabilityForDate: jest.fn().mockResolvedValue({
        date: '2026-10-05',
        slots: [
          {
            startAt: SLOT_START,
            endAt: SLOT_END,
            durationMinutes: 30,
          },
        ],
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        AppointmentsService,
        HoldService,
        { provide: AvailabilityService, useValue: availabilityServiceMock },
        { provide: CALENDAR_PORT, useValue: calendarPortMock },
        { provide: PrismaService, useValue: prismaServiceMock },
        { provide: RedisService, useValue: redisServiceMock },
        {
          provide: StructuredLoggerService,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  let createdAppointmentId: string;

  it('Step 1: POST /internal/appointments/book -> acquires hold in Redis and creates SOLICITADA appointment in Postgres (201 Created)', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/appointments/book')
      .send({
        clinicId: CLINIC_ID,
        doctorId: DOCTOR_ID,
        patientId: PATIENT_ID,
        conversationId: CONVERSATION_A,
        startAt: SLOT_START,
        motivo: 'Limpieza dental regular',
      })
      .expect(201);

    expect(response.body.appointment).toBeDefined();
    expect(response.body.status).toBe(AppointmentStatus.SOLICITADA);
    expect(response.body.isIdempotentReplay).toBe(false);
    expect(response.body.appointment.holdExpiresAt).toBeDefined();

    createdAppointmentId = response.body.appointment.id;

    // Verify Redis hold key was set
    const slotKey = `hold:slot:${CLINIC_ID}:${DOCTOR_ID}:${SLOT_START}`;
    expect(redisStorage.get(slotKey)).toBe(CONVERSATION_A);
  });

  it('Step 2: POST /internal/appointments/book -> repeated request with same conversationId returns 200 OK without creating duplicate', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/appointments/book')
      .send({
        clinicId: CLINIC_ID,
        doctorId: DOCTOR_ID,
        patientId: PATIENT_ID,
        conversationId: CONVERSATION_A,
        startAt: SLOT_START,
        motivo: 'Limpieza dental regular',
      })
      .expect(200);

    expect(response.body.appointment.id).toBe(createdAppointmentId);
    expect(response.body.isIdempotentReplay).toBe(true);
    expect(appointmentsDb.size).toBe(1);
  });

  it('Step 3: POST /internal/appointments/confirm -> confirms appointment, releases hold and creates Calendar event (200 OK)', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/appointments/confirm')
      .send({
        appointmentId: createdAppointmentId,
        clinicId: CLINIC_ID,
        conversationId: CONVERSATION_A,
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe(AppointmentStatus.CONFIRMADA);
    expect(response.body.calendarSyncStatus).toBe('SYNCED');
    expect(response.body.calendarEventId).toBe('gcal-event-walking-123');
    expect(response.body.patientMessage).toContain('confirmada con éxito');

    // Verify Redis hold was released
    const slotKey = `hold:slot:${CLINIC_ID}:${DOCTOR_ID}:${SLOT_START}`;
    expect(redisStorage.get(slotKey)).toBeUndefined();

    // Verify Postgres record updated
    const apptInDb = appointmentsDb.get(createdAppointmentId);
    expect(apptInDb.status).toBe(AppointmentStatus.CONFIRMADA);
  });

  it('Step 4: POST /internal/appointments/confirm -> repeated confirmation returns 200 OK (isPriorConfirmation: true) idempotently', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/appointments/confirm')
      .send({
        appointmentId: createdAppointmentId,
        clinicId: CLINIC_ID,
        conversationId: CONVERSATION_A,
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.isIdempotentReplay).toBe(true);
    expect(response.body.status).toBe(AppointmentStatus.CONFIRMADA);

    // Verify Google Calendar was NOT called a second time
    expect(calendarPortMock.createEvent).toHaveBeenCalledTimes(1);
  });

  it('Step 5: POST /internal/appointments/confirm -> rejected when another conversation attempts to confirm or claim', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/appointments/confirm')
      .send({
        appointmentId: createdAppointmentId,
        clinicId: CLINIC_ID,
        conversationId: CONVERSATION_B, // Intruder conversation
      })
      .expect(400);

    expect(response.body.message).toContain('ya fue confirmada previamente por otra conversación');
  });
});
