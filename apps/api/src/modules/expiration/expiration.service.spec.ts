import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AppointmentStatus, JobStatus } from '@prisma/client';
import { ExpirationService } from './expiration.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';

/**
 * PostgreSQL Exclusion Constraint Simulator:
 * Emulates the exact behavior of PostgreSQL's partial exclusion constraint:
 * CONSTRAINT appointment_no_overlapping_active_slots
 * EXCLUDE USING gist (
 *   "doctorId" WITH =,
 *   tsrange("startAt", "endAt") WITH &&
 * ) WHERE ("status" IN ('SOLICITADA', 'CONFIRMADA'));
 */
class PostgresExclusionConstraintSimulator {
  private records: Array<{
    id: string;
    clinicId: string;
    doctorId: string;
    startAt: Date;
    endAt: Date;
    status: AppointmentStatus;
  }> = [];

  /**
   * Checks whether two time ranges [startA, endA) and [startB, endB) overlap (&& in PostgreSQL).
   */
  private rangesOverlap(
    startA: Date,
    endA: Date,
    startB: Date,
    endB: Date,
  ): boolean {
    return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
  }

  /**
   * Simulates inserting or updating an appointment in PostgreSQL under the exclusion constraint.
   * Throws a simulated Postgres error with code 23P01 if an active overlapping appointment exists.
   */
  insert(record: {
    id: string;
    clinicId: string;
    doctorId: string;
    startAt: Date;
    endAt: Date;
    status: AppointmentStatus;
  }) {
    // Only enforced for active statuses (WHERE condition)
    if (
      record.status === AppointmentStatus.SOLICITADA ||
      record.status === AppointmentStatus.CONFIRMADA
    ) {
      for (const existing of this.records) {
        if (
          existing.doctorId === record.doctorId &&
          (existing.status === AppointmentStatus.SOLICITADA ||
            existing.status === AppointmentStatus.CONFIRMADA)
        ) {
          if (
            this.rangesOverlap(
              existing.startAt,
              existing.endAt,
              record.startAt,
              record.endAt,
            )
          ) {
            const err: any = new Error(
              `conflicting key value violates exclusion constraint "appointment_no_overlapping_active_slots"`,
            );
            err.code = '23P01'; // PostgreSQL code for exclusion_violation
            err.table = 'appointments';
            err.constraint = 'appointment_no_overlapping_active_slots';
            throw err;
          }
        }
      }
    }

    this.records.push({ ...record });
    return record;
  }

  updateStatus(id: string, status: AppointmentStatus) {
    const rec = this.records.find((r) => r.id === id);
    if (rec) {
      rec.status = status;
    }
  }

  getRecords() {
    return this.records;
  }

  clear() {
    this.records = [];
  }
}

describe('ExpirationService (E2.2c / RF-025 / RNF-001 / RNF-011)', () => {
  let service: ExpirationService;
  let prismaMock: any;
  let redisMock: any;
  let loggerMock: any;

  let redisStore: Map<string, string>;

  beforeEach(async () => {
    redisStore = new Map<string, string>();

    redisMock = {
      get: jest.fn(async (key: string) => redisStore.get(key) || null),
      set: jest.fn(async (key: string, val: string) => {
        redisStore.set(key, val);
        return 'OK';
      }),
      del: jest.fn(async (key: string) => {
        const deleted = redisStore.delete(key);
        return deleted ? 1 : 0;
      }),
      keys: jest.fn(async (pattern: string) => {
        const results: string[] = [];
        for (const k of redisStore.keys()) {
          if (pattern === 'hold:*' && k.startsWith('hold:')) {
            results.push(k);
          } else if (k.includes(pattern.replace('*', ''))) {
            results.push(k);
          }
        }
        return results;
      }),
    };

    prismaMock = {
      appointment: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      scheduledJob: {
        upsert: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => {
        return callback(prismaMock);
      }),
    };

    loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpirationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
        { provide: StructuredLoggerService, useValue: loggerMock },
      ],
    }).compile();

    service = module.get<ExpirationService>(ExpirationService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('1. Verificación Perezosa (Lazy Check) - checkAndExpireAppointment', () => {
    const fixedNow = new Date('2026-09-17T10:00:00.000Z');
    const clinicId = 'clinic-lazy-1';
    const doctorId = 'doctor-lazy-1';
    const appointmentId = 'appt-lazy-1';
    const startAt = new Date('2026-09-17T11:00:00.000Z');
    const startAtIso = startAt.toISOString();
    const slotKey = `hold:slot:${clinicId}:${doctorId}:${startAtIso}`;
    const counterKey = `hold:count:${clinicId}:${doctorId}`;

    it('throws NotFoundException when appointment is not found in database', async () => {
      prismaMock.appointment.findUnique.mockResolvedValue(null);

      await expect(
        service.checkAndExpireAppointment('non-existent-id'),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      expect(redisMock.del).not.toHaveBeenCalled();
    });

    it('returns appointment unmodified when hold has NOT expired (holdExpiresAt > NOW)', async () => {
      const activeHoldExpiresAt = new Date('2026-09-17T10:15:00.000Z'); // 15 mins in future
      const activeAppt = {
        id: appointmentId,
        clinicId,
        doctorId,
        patientId: 'pat-1',
        status: AppointmentStatus.SOLICITADA,
        startAt,
        endAt: new Date('2026-09-17T11:30:00.000Z'),
        holdExpiresAt: activeHoldExpiresAt,
      };

      prismaMock.appointment.findUnique.mockResolvedValue(activeAppt);

      const result = await service.checkAndExpireAppointment(appointmentId, {
        nowOverride: fixedNow,
      });

      expect(result.status).toBe(AppointmentStatus.SOLICITADA);
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      expect(redisMock.del).not.toHaveBeenCalled();
    });

    it('returns appointment unmodified if status is CONFIRMADA even if holdExpiresAt < NOW', async () => {
      const pastHoldExpiresAt = new Date('2026-09-17T09:45:00.000Z'); // 15 mins in past
      const confirmedAppt = {
        id: appointmentId,
        clinicId,
        doctorId,
        patientId: 'pat-1',
        status: AppointmentStatus.CONFIRMADA,
        startAt,
        endAt: new Date('2026-09-17T11:30:00.000Z'),
        holdExpiresAt: pastHoldExpiresAt,
      };

      prismaMock.appointment.findUnique.mockResolvedValue(confirmedAppt);

      const result = await service.checkAndExpireAppointment(appointmentId, {
        nowOverride: fixedNow,
      });

      expect(result.status).toBe(AppointmentStatus.CONFIRMADA);
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      expect(redisMock.del).not.toHaveBeenCalled();
    });

    it('atomically expires appointment, deletes Redis slot lock, and reconciles doctor counter when hold is expired', async () => {
      const expiredHoldAt = new Date('2026-09-17T09:59:00.000Z'); // 1 min in past
      const expiredAppt = {
        id: appointmentId,
        clinicId,
        doctorId,
        patientId: 'pat-1',
        status: AppointmentStatus.SOLICITADA,
        startAt,
        endAt: new Date('2026-09-17T11:30:00.000Z'),
        holdExpiresAt: expiredHoldAt,
      };

      // Set initial Redis state
      redisStore.set(slotKey, 'conv-123');
      redisStore.set(counterKey, '2');

      prismaMock.appointment.findUnique.mockResolvedValue(expiredAppt);
      prismaMock.appointment.update.mockResolvedValue({
        ...expiredAppt,
        status: AppointmentStatus.EXPIRADA,
      });
      // Mock remaining active holds count for doctor = 1
      prismaMock.appointment.count.mockResolvedValue(1);

      const result = await service.checkAndExpireAppointment(appointmentId, {
        nowOverride: fixedNow,
      });

      // 1. Assert status transitioned to EXPIRADA
      expect(result.status).toBe(AppointmentStatus.EXPIRADA);
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.EXPIRADA },
      });

      // 2. Assert Redis slot lock was deleted
      expect(redisMock.del).toHaveBeenCalledWith(slotKey);
      expect(redisStore.has(slotKey)).toBe(false);

      // 3. Assert doctor counter was reconciled against DB count
      expect(prismaMock.appointment.count).toHaveBeenCalledWith({
        where: {
          clinicId,
          doctorId,
          status: AppointmentStatus.SOLICITADA,
          holdExpiresAt: {
            gt: fixedNow,
          },
        },
      });
      expect(redisStore.get(counterKey)).toBe('1');

      // 4. Assert structured logging
      expect(loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining('lazy expired'),
        'ExpirationService',
        expect.objectContaining({
          appointmentId,
          clinicId,
          doctorId,
        }),
      );
    });
  });

  describe('2. Barrido Periódico (Scheduled Sweeper) - sweepExpiredHolds', () => {
    const fixedNow = new Date('2026-09-17T10:00:00.000Z');
    const dateStr = '2026-09-17';

    const clinicA = 'clinic-alpha';
    const clinicB = 'clinic-beta';
    const doctorA1 = 'doctor-a1';
    const doctorB1 = 'doctor-b1';

    const expiredApptA1 = {
      id: 'appt-a1',
      clinicId: clinicA,
      doctorId: doctorA1,
      startAt: new Date('2026-09-17T11:00:00.000Z'),
      endAt: new Date('2026-09-17T11:30:00.000Z'),
      holdExpiresAt: new Date('2026-09-17T09:40:00.000Z'),
      status: AppointmentStatus.SOLICITADA,
    };

    const expiredApptA2 = {
      id: 'appt-a2',
      clinicId: clinicA,
      doctorId: doctorA1,
      startAt: new Date('2026-09-17T14:00:00.000Z'),
      endAt: new Date('2026-09-17T14:30:00.000Z'),
      holdExpiresAt: new Date('2026-09-17T09:50:00.000Z'),
      status: AppointmentStatus.SOLICITADA,
    };

    const expiredApptB1 = {
      id: 'appt-b1',
      clinicId: clinicB,
      doctorId: doctorB1,
      startAt: new Date('2026-09-17T16:00:00.000Z'),
      endAt: new Date('2026-09-17T16:30:00.000Z'),
      holdExpiresAt: new Date('2026-09-17T09:55:00.000Z'),
      status: AppointmentStatus.SOLICITADA,
    };

    it('sweeps multiple expired holds across clinics, transitions to EXPIRADA, and records idempotent ScheduledJobs', async () => {
      // Mock active holds found
      prismaMock.appointment.findMany.mockResolvedValue([
        expiredApptA1,
        expiredApptA2,
        expiredApptB1,
      ]);

      // Populate Redis
      const slotA1 = `hold:slot:${clinicA}:${doctorA1}:${expiredApptA1.startAt.toISOString()}`;
      const slotA2 = `hold:slot:${clinicA}:${doctorA1}:${expiredApptA2.startAt.toISOString()}`;
      const slotB1 = `hold:slot:${clinicB}:${doctorB1}:${expiredApptB1.startAt.toISOString()}`;
      redisStore.set(slotA1, 'conv-a1');
      redisStore.set(slotA2, 'conv-a2');
      redisStore.set(slotB1, 'conv-b1');
      redisStore.set(`hold:count:${clinicA}:${doctorA1}`, '2');
      redisStore.set(`hold:count:${clinicB}:${doctorB1}`, '1');

      prismaMock.appointment.update.mockImplementation(async ({ where, data }: any) => ({
        id: where.id,
        ...data,
      }));

      prismaMock.scheduledJob.upsert.mockImplementation(async ({ where, create }: any) => ({
        id: `job-${where.idempotencyKey}`,
        ...create,
      }));

      // No more active holds remaining after sweep
      prismaMock.appointment.count.mockResolvedValue(0);

      const sweepResult = await service.sweepExpiredHolds(undefined, {
        nowOverride: fixedNow,
      });

      expect(sweepResult.expiredCount).toBe(3);
      expect(sweepResult.processedJobIds).toHaveLength(3);

      // Verify appointments were updated to EXPIRADA
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: expiredApptA1.id },
        data: { status: AppointmentStatus.EXPIRADA },
      });
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: expiredApptA2.id },
        data: { status: AppointmentStatus.EXPIRADA },
      });
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: expiredApptB1.id },
        data: { status: AppointmentStatus.EXPIRADA },
      });

      // Verify ScheduledJob idempotency key format: tipo:clinicaId:entidadId:fechaEjecucion
      expect(prismaMock.scheduledJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            idempotencyKey: `expiracion_hold:${clinicA}:${expiredApptA1.id}:${dateStr}`,
          },
          create: expect.objectContaining({
            clinicId: clinicA,
            type: 'expiracion_hold',
            entityId: expiredApptA1.id,
            executionDate: dateStr,
            status: JobStatus.COMPLETED,
            attempts: 1,
          }),
        }),
      );

      // Verify Redis slots were cleared
      expect(redisStore.has(slotA1)).toBe(false);
      expect(redisStore.has(slotA2)).toBe(false);
      expect(redisStore.has(slotB1)).toBe(false);

      // Verify doctor counters were reconciled
      expect(redisStore.get(`hold:count:${clinicA}:${doctorA1}`)).toBe('0');
      expect(redisStore.get(`hold:count:${clinicB}:${doctorB1}`)).toBe('0');
    });

    it('filters strictly by clinicId when clinicId is supplied to sweeper', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([expiredApptA1, expiredApptA2]);
      prismaMock.appointment.update.mockResolvedValue({ status: AppointmentStatus.EXPIRADA });
      prismaMock.scheduledJob.upsert.mockResolvedValue({ id: 'job-1' });
      prismaMock.appointment.count.mockResolvedValue(0);

      const sweepResult = await service.sweepExpiredHolds(clinicA, {
        nowOverride: fixedNow,
      });

      expect(sweepResult.expiredCount).toBe(2);
      expect(prismaMock.appointment.findMany).toHaveBeenCalledWith({
        where: {
          clinicId: clinicA,
          status: AppointmentStatus.SOLICITADA,
          holdExpiresAt: {
            lte: fixedNow,
          },
        },
        select: expect.any(Object),
      });
    });

    it('re-running the sweeper on the same day is idempotent without creating duplicate jobs', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([expiredApptA1]);
      prismaMock.appointment.update.mockResolvedValue({
        id: expiredApptA1.id,
        status: AppointmentStatus.EXPIRADA,
      });

      let attemptsTracked = 0;
      prismaMock.scheduledJob.upsert.mockImplementation(async ({ update, create }: any) => {
        attemptsTracked++;
        return {
          id: `job-existing-1`,
          idempotencyKey: `expiracion_hold:${clinicA}:${expiredApptA1.id}:${dateStr}`,
          attempts: attemptsTracked,
          status: JobStatus.COMPLETED,
        };
      });
      prismaMock.appointment.count.mockResolvedValue(0);

      // First run
      const result1 = await service.sweepExpiredHolds(clinicA, { nowOverride: fixedNow });
      expect(result1.expiredCount).toBe(1);

      // Second run (simulating re-execution)
      const result2 = await service.sweepExpiredHolds(clinicA, { nowOverride: fixedNow });
      expect(result2.expiredCount).toBe(1);

      // Verify upsert was called with idempotency key both times
      expect(prismaMock.scheduledJob.upsert).toHaveBeenCalledTimes(2);
      expect(prismaMock.scheduledJob.upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            idempotencyKey: `expiracion_hold:${clinicA}:${expiredApptA1.id}:${dateStr}`,
          },
          update: expect.objectContaining({
            status: JobStatus.COMPLETED,
          }),
        }),
      );
    });
  });

  describe('3. Simulación de Partial Exclusion Constraint en PostgreSQL (Defensa en BD)', () => {
    let pgSimulator: PostgresExclusionConstraintSimulator;

    beforeEach(() => {
      pgSimulator = new PostgresExclusionConstraintSimulator();
    });

    it('rejects direct concurrent overlapping appointments for same doctor with status SOLICITADA (PostgreSQL Error 23P01)', () => {
      const doctorId = 'doc-exclusion-1';
      const clinicId = 'clinic-1';

      // 1. Insert first active appointment [10:00 - 10:30)
      const appt1 = {
        id: 'appt-1',
        clinicId,
        doctorId,
        startAt: new Date('2026-09-17T10:00:00.000Z'),
        endAt: new Date('2026-09-17T10:30:00.000Z'),
        status: AppointmentStatus.SOLICITADA,
      };
      expect(() => pgSimulator.insert(appt1)).not.toThrow();

      // 2. Attempt to insert overlapping appointment [10:15 - 10:45) for same doctor
      const appt2Overlapping = {
        id: 'appt-2',
        clinicId,
        doctorId,
        startAt: new Date('2026-09-17T10:15:00.000Z'),
        endAt: new Date('2026-09-17T10:45:00.000Z'),
        status: AppointmentStatus.SOLICITADA,
      };

      expect(() => pgSimulator.insert(appt2Overlapping)).toThrow(
        expect.objectContaining({
          message: expect.stringContaining(
            'violates exclusion constraint "appointment_no_overlapping_active_slots"',
          ),
          code: '23P01',
          constraint: 'appointment_no_overlapping_active_slots',
        }),
      );
    });

    it('rejects overlapping CONFIRMADA appointment with an existing SOLICITADA appointment', () => {
      const doctorId = 'doc-exclusion-2';
      const clinicId = 'clinic-1';

      // First appointment SOLICITADA [11:00 - 11:30)
      pgSimulator.insert({
        id: 'appt-hold',
        clinicId,
        doctorId,
        startAt: new Date('2026-09-17T11:00:00.000Z'),
        endAt: new Date('2026-09-17T11:30:00.000Z'),
        status: AppointmentStatus.SOLICITADA,
      });

      // Second appointment CONFIRMADA [11:00 - 11:30) exactly identical interval
      expect(() =>
        pgSimulator.insert({
          id: 'appt-confirmed-conflict',
          clinicId,
          doctorId,
          startAt: new Date('2026-09-17T11:00:00.000Z'),
          endAt: new Date('2026-09-17T11:30:00.000Z'),
          status: AppointmentStatus.CONFIRMADA,
        }),
      ).toThrow(
        expect.objectContaining({
          code: '23P01',
        }),
      );
    });

    it('allows overlapping appointments across DIFFERENT doctors', () => {
      const clinicId = 'clinic-1';
      const doctorA = 'doc-A';
      const doctorB = 'doc-B';
      const timeStart = new Date('2026-09-17T15:00:00.000Z');
      const timeEnd = new Date('2026-09-17T15:30:00.000Z');

      // Doctor A takes 15:00 - 15:30
      expect(() =>
        pgSimulator.insert({
          id: 'appt-doc-a',
          clinicId,
          doctorId: doctorA,
          startAt: timeStart,
          endAt: timeEnd,
          status: AppointmentStatus.SOLICITADA,
        }),
      ).not.toThrow();

      // Doctor B takes the exact same interval 15:00 - 15:30
      expect(() =>
        pgSimulator.insert({
          id: 'appt-doc-b',
          clinicId,
          doctorId: doctorB,
          startAt: timeStart,
          endAt: timeEnd,
          status: AppointmentStatus.SOLICITADA,
        }),
      ).not.toThrow();

      expect(pgSimulator.getRecords()).toHaveLength(2);
    });

    it('allows adjacent non-overlapping slots for the same doctor [10:00, 10:30) and [10:30, 11:00)', () => {
      const doctorId = 'doc-adjacent';
      const clinicId = 'clinic-1';

      expect(() =>
        pgSimulator.insert({
          id: 'appt-slot-1',
          clinicId,
          doctorId,
          startAt: new Date('2026-09-17T10:00:00.000Z'),
          endAt: new Date('2026-09-17T10:30:00.000Z'),
          status: AppointmentStatus.SOLICITADA,
        }),
      ).not.toThrow();

      expect(() =>
        pgSimulator.insert({
          id: 'appt-slot-2',
          clinicId,
          doctorId,
          startAt: new Date('2026-09-17T10:30:00.000Z'),
          endAt: new Date('2026-09-17T11:00:00.000Z'),
          status: AppointmentStatus.SOLICITADA,
        }),
      ).not.toThrow();

      expect(pgSimulator.getRecords()).toHaveLength(2);
    });

    it('allows re-booking a slot when previous appointment transitions to EXPIRADA (WHERE clause partial index)', () => {
      const doctorId = 'doc-reuse';
      const clinicId = 'clinic-1';
      const slotStart = new Date('2026-09-17T12:00:00.000Z');
      const slotEnd = new Date('2026-09-17T12:30:00.000Z');

      // 1. Initial appointment in SOLICITADA
      pgSimulator.insert({
        id: 'appt-old',
        clinicId,
        doctorId,
        startAt: slotStart,
        endAt: slotEnd,
        status: AppointmentStatus.SOLICITADA,
      });

      // Overlapping insert fails while status is SOLICITADA
      expect(() =>
        pgSimulator.insert({
          id: 'appt-new',
          clinicId,
          doctorId,
          startAt: slotStart,
          endAt: slotEnd,
          status: AppointmentStatus.SOLICITADA,
        }),
      ).toThrow();

      // 2. Old appointment expires via lazy check or sweeper
      pgSimulator.updateStatus('appt-old', AppointmentStatus.EXPIRADA);

      // 3. New appointment can now be inserted into the same slot!
      expect(() =>
        pgSimulator.insert({
          id: 'appt-new',
          clinicId,
          doctorId,
          startAt: slotStart,
          endAt: slotEnd,
          status: AppointmentStatus.SOLICITADA,
        }),
      ).not.toThrow();

      expect(pgSimulator.getRecords()).toHaveLength(2);
    });
  });
});
