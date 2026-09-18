import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import {
  HoldService,
  ACQUIRE_HOLD_LUA,
  RELEASE_HOLD_LUA,
} from './hold.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';

/**
 * Stateful in-memory Redis simulator implementing exact Lua atomic logic
 * for testing concurrency and script mechanics without an external Redis daemon.
 */
class MockRedisStore {
  private data = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.data.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(pattern: string): Promise<string[]> {
    const now = Date.now();
    const result: string[] = [];
    for (const [k, v] of this.data.entries()) {
      if (v.expiresAt && v.expiresAt <= now) {
        this.data.delete(k);
        continue;
      }
      if (pattern === 'hold:*' && k.startsWith('hold:')) {
        result.push(k);
      } else if (pattern.startsWith('hold:*') && k.includes(pattern.split('*')[1] || '')) {
        result.push(k);
      } else if (k.startsWith('hold:')) {
        result.push(k);
      }
    }
    return result;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.data.get(key);
    if (!entry) return -2;
    if (!entry.expiresAt) return -1;
    const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  /**
   * Executes atomic Lua logic corresponding to ACQUIRE_HOLD_LUA and RELEASE_HOLD_LUA
   */
  async eval(
    script: string,
    numkeys: number,
    ...args: (string | number)[]
  ): Promise<any> {
    if (script === ACQUIRE_HOLD_LUA) {
      const slotKey = String(args[0]);
      const counterKey = String(args[1]);
      const conversationId = String(args[2]);
      const ttlSeconds = Number(args[3]);
      const maxConcurrentHolds = Number(args[4]);

      // 1. Check current holds
      const currentEntry = this.data.get(counterKey);
      const currentHolds = currentEntry ? parseInt(currentEntry.value, 10) || 0 : 0;

      if (currentHolds >= maxConcurrentHolds) {
        return [0, 'MAX_HOLDS_EXCEEDED'];
      }

      // 2. Try SET NX EX
      const existingSlot = this.data.get(slotKey);
      const now = Date.now();
      if (existingSlot && (!existingSlot.expiresAt || existingSlot.expiresAt > now)) {
        return [0, 'SLOT_ALREADY_LOCKED'];
      }

      // 3. Acquired: set slot and INCR counter
      this.data.set(slotKey, {
        value: conversationId,
        expiresAt: now + ttlSeconds * 1000,
      });
      this.data.set(counterKey, {
        value: String(currentHolds + 1),
      });

      return [1, 'OK'];
    }

    if (script === RELEASE_HOLD_LUA) {
      const slotKey = String(args[0]);
      const counterKey = String(args[1]);
      const conversationId = String(args[2]);

      const slotEntry = this.data.get(slotKey);
      const now = Date.now();
      if (slotEntry && (!slotEntry.expiresAt || slotEntry.expiresAt > now)) {
        if (slotEntry.value === conversationId) {
          this.data.delete(slotKey);
          const counterEntry = this.data.get(counterKey);
          const currentHolds = counterEntry ? parseInt(counterEntry.value, 10) || 0 : 0;
          const nextCount = Math.max(0, currentHolds - 1);
          this.data.set(counterKey, { value: String(nextCount) });
          return 1;
        }
      }
      return 0;
    }

    throw new Error(`Unrecognized script in MockRedisStore: ${script}`);
  }

  clear() {
    this.data.clear();
  }

  dump(): Map<string, { value: string; expiresAt?: number }> {
    return new Map(this.data);
  }
}

describe('HoldService (E2.2b - Distributed Redis Locking & Atomic Hold)', () => {
  let service: HoldService;
  let mockRedis: MockRedisStore;
  let prisma: any;
  let loggerMock: any;

  const mockClinicId = '11111111-1111-1111-1111-111111111111';
  const mockDoctorId = '22222222-2222-2222-2222-222222222222';
  const mockSlotTime = '2026-09-18T14:00:00.000Z';

  beforeEach(async () => {
    mockRedis = new MockRedisStore();

    prisma = {
      doctor: {
        findFirst: jest.fn(),
      },
      clinic: {
        findUnique: jest.fn(),
      },
      appointment: {
        findMany: jest.fn(),
      },
    };

    loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HoldService,
        {
          provide: RedisService,
          useValue: {
            get: jest.fn((k) => mockRedis.get(k)),
            set: jest.fn((k, v, ttl) => mockRedis.set(k, v, ttl)),
            del: jest.fn((k) => mockRedis.del(k)),
            keys: jest.fn((pattern) => mockRedis.keys(pattern)),
            ttl: jest.fn((k) => mockRedis.ttl(k)),
            eval: jest.fn((script, numkeys, ...args) =>
              mockRedis.eval(script, numkeys, ...args),
            ),
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: StructuredLoggerService, useValue: loggerMock },
      ],
    }).compile();

    service = module.get<HoldService>(HoldService);
  });

  afterEach(() => {
    mockRedis.clear();
    jest.clearAllMocks();
  });

  describe('1. Key Formatting & Standardized Keys', () => {
    it('should generate standard slot lock key with clinicId, doctorId, and startAtIso', () => {
      const slotKey = service.getSlotKey(mockClinicId, mockDoctorId, mockSlotTime);
      expect(slotKey).toBe(
        `hold:slot:${mockClinicId}:${mockDoctorId}:${mockSlotTime}`,
      );
    });

    it('should generate standard doctor hold counter key with clinicId and doctorId', () => {
      const counterKey = service.getCounterKey(mockClinicId, mockDoctorId);
      expect(counterKey).toBe(`hold:count:${mockClinicId}:${mockDoctorId}`);
    });
  });

  describe('2. Resolution of maxConcurrentHolds hierarchy', () => {
    it('should return doctor override when doctor has maxConcurrentHolds set', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        maxConcurrentHolds: 5,
        clinic: { maxConcurrentHolds: 3 },
      });

      const maxHolds = await service.resolveMaxConcurrentHolds(
        mockClinicId,
        mockDoctorId,
      );
      expect(maxHolds).toBe(5);
      expect(prisma.doctor.findFirst).toHaveBeenCalledWith({
        where: { clinicId: mockClinicId, id: mockDoctorId },
        select: expect.any(Object),
      });
    });

    it('should fallback to clinic setting when doctor.maxConcurrentHolds is null', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        maxConcurrentHolds: null,
        clinic: { maxConcurrentHolds: 4 },
      });

      const maxHolds = await service.resolveMaxConcurrentHolds(
        mockClinicId,
        mockDoctorId,
      );
      expect(maxHolds).toBe(4);
    });

    it('should fallback to default 3 when both doctor and clinic are null/undefined', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        maxConcurrentHolds: null,
        clinic: { maxConcurrentHolds: null },
      });

      const maxHolds = await service.resolveMaxConcurrentHolds(
        mockClinicId,
        mockDoctorId,
      );
      expect(maxHolds).toBe(3);
    });

    it('should throw NotFoundException if doctor does not belong to clinic', async () => {
      prisma.doctor.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveMaxConcurrentHolds(mockClinicId, mockDoctorId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('3. Atomic Acquisition (acquireHold & Lua script atomicity)', () => {
    beforeEach(() => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        maxConcurrentHolds: 3,
        clinic: { maxConcurrentHolds: 3 },
      });
    });

    it('should successfully acquire a hold and increment doctor counter', async () => {
      const res = await service.acquireHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: mockSlotTime,
        conversationId: 'conv-user-1',
        traceId: 'trace-101',
      });

      expect(res.success).toBe(true);
      expect(res.ttlSeconds).toBe(900);
      expect(res.slotKey).toBe(
        `hold:slot:${mockClinicId}:${mockDoctorId}:${mockSlotTime}`,
      );

      // Verify Redis state
      const slotOwner = await service.getHold(mockClinicId, mockDoctorId, mockSlotTime);
      expect(slotOwner).toBe('conv-user-1');

      const count = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(count).toBe(1);

      // Verify structured logger
      expect(loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining('Hold acquired successfully'),
        'HoldService',
        expect.objectContaining({
          traceId: 'trace-101',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          conversationId: 'conv-user-1',
        }),
      );
    });

    it('should reject atomically when doctor reaches maxConcurrentHolds (default 3)', async () => {
      // Acquire 3 holds for 3 different slots
      const slot1 = '2026-09-18T14:00:00.000Z';
      const slot2 = '2026-09-18T14:30:00.000Z';
      const slot3 = '2026-09-18T15:00:00.000Z';
      const slot4 = '2026-09-18T15:30:00.000Z';

      const res1 = await service.acquireHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: slot1,
        conversationId: 'conv-1',
      });
      const res2 = await service.acquireHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: slot2,
        conversationId: 'conv-2',
      });
      const res3 = await service.acquireHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: slot3,
        conversationId: 'conv-3',
      });

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(res3.success).toBe(true);

      const countBefore = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(countBefore).toBe(3);

      // 4th attempt must be rejected with MAX_HOLDS_EXCEEDED
      const res4 = await service.acquireHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: slot4,
        conversationId: 'conv-4',
        traceId: 'trace-overflow',
      });

      expect(res4.success).toBe(false);
      expect(res4.reason).toBe('MAX_HOLDS_EXCEEDED');

      // Crucial: 4th slot MUST NOT be touched/locked in Redis
      const slot4Owner = await service.getHold(mockClinicId, mockDoctorId, slot4);
      expect(slot4Owner).toBeNull();

      // Counter must remain 3
      const countAfter = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(countAfter).toBe(3);

      // Warning logged
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('Hold acquisition rejected'),
        'HoldService',
        expect.objectContaining({
          reason: 'MAX_HOLDS_EXCEEDED',
          maxConcurrentHolds: 3,
        }),
      );
    });

    it('should respect custom maxConcurrentHolds override passed in params', async () => {
      // Pass maxConcurrentHolds: 1
      const res1 = await service.acquireHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: '2026-09-18T14:00:00.000Z',
        conversationId: 'conv-1',
        maxConcurrentHolds: 1,
      });
      expect(res1.success).toBe(true);

      const res2 = await service.acquireHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: '2026-09-18T14:30:00.000Z',
        conversationId: 'conv-2',
        maxConcurrentHolds: 1,
      });
      expect(res2.success).toBe(false);
      expect(res2.reason).toBe('MAX_HOLDS_EXCEEDED');
    });

    it('should reject when two concurrent calls compete for the EXACT same slot (only 1 winner)', async () => {
      // Simulate race condition: conv-A and conv-B compete for mockSlotTime simultaneously
      const [attemptA, attemptB] = await Promise.all([
        service.acquireHold({
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startAt: mockSlotTime,
          conversationId: 'conv-patient-A',
        }),
        service.acquireHold({
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startAt: mockSlotTime,
          conversationId: 'conv-patient-B',
        }),
      ]);

      // Exactly one succeeds and one fails with SLOT_ALREADY_LOCKED
      const winners = [attemptA, attemptB].filter((r) => r.success);
      const losers = [attemptA, attemptB].filter((r) => !r.success);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);
      expect(losers[0].reason).toBe('SLOT_ALREADY_LOCKED');

      // Counter was incremented by exactly 1, not 2
      const count = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(count).toBe(1);

      // Winning conversation holds the slot
      const holder = await service.getHold(mockClinicId, mockDoctorId, mockSlotTime);
      expect(['conv-patient-A', 'conv-patient-B']).toContain(holder);
    });
  });

  describe('4. Atomic Release (releaseHold & Lua script atomicity)', () => {
    beforeEach(async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        maxConcurrentHolds: 3,
        clinic: { maxConcurrentHolds: 3 },
      });

      await service.acquireHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: mockSlotTime,
        conversationId: 'conv-original',
      });
    });

    it('should successfully release hold and decrement counter when conversationId matches', async () => {
      const countBefore = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(countBefore).toBe(1);

      const res = await service.releaseHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: mockSlotTime,
        conversationId: 'conv-original',
        traceId: 'trace-rel-1',
      });

      expect(res.released).toBe(true);

      // Slot must be free in Redis
      const holder = await service.getHold(mockClinicId, mockDoctorId, mockSlotTime);
      expect(holder).toBeNull();

      // Counter decremented to 0
      const countAfter = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(countAfter).toBe(0);

      expect(loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining('Hold released successfully'),
        'HoldService',
        expect.objectContaining({
          conversationId: 'conv-original',
        }),
      );
    });

    it('should refuse to release and preserve lock if conversationId does NOT match', async () => {
      const res = await service.releaseHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: mockSlotTime,
        conversationId: 'conv-imposter',
      });

      expect(res.released).toBe(false);

      // Slot is still held by original conversation
      const holder = await service.getHold(mockClinicId, mockDoctorId, mockSlotTime);
      expect(holder).toBe('conv-original');

      // Counter is NOT decremented
      const count = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(count).toBe(1);

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('Hold release ignored or conversation mismatch'),
        'HoldService',
        expect.any(Object),
      );
    });

    it('should allow re-acquisition after release by another conversation', async () => {
      // 1. Original conversation releases
      await service.releaseHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: mockSlotTime,
        conversationId: 'conv-original',
      });

      // 2. New conversation acquires the exact same slot
      const reAcquire = await service.acquireHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: mockSlotTime,
        conversationId: 'conv-new-patient',
      });

      expect(reAcquire.success).toBe(true);
      const newHolder = await service.getHold(mockClinicId, mockDoctorId, mockSlotTime);
      expect(newHolder).toBe('conv-new-patient');
    });

    it('should never decrement counter below 0 even on extra release calls', async () => {
      // First release
      await service.releaseHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: mockSlotTime,
        conversationId: 'conv-original',
      });

      // Second release on same slot
      const secondRelease = await service.releaseHold({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        startAt: mockSlotTime,
        conversationId: 'conv-original',
      });

      expect(secondRelease.released).toBe(false);
      const count = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(count).toBe(0);
    });
  });

  describe('5. Startup Reconciliation (reconcileHoldsOnStartup & restart recovery)', () => {
    const simulationNow = new Date('2026-09-18T12:00:00.000Z');
    const futureExpires1 = new Date('2026-09-18T12:10:00.000Z'); // 600s remaining
    const futureExpires2 = new Date('2026-09-18T12:12:00.000Z'); // 720s remaining

    it('should restore slots and doctor counters from PostgreSQL after simulated Redis cold restart', async () => {
      // Redis is completely empty (cold start)
      expect(await mockRedis.keys('hold:*')).toEqual([]);

      // Postgres has 2 active SOLICITADA appointments with unexpired holds
      prisma.appointment.findMany.mockResolvedValue([
        {
          id: 'appt-1',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startAt: new Date('2026-09-18T14:00:00.000Z'),
          holdExpiresAt: futureExpires1,
          conversationId: 'conv-patient-1',
        },
        {
          id: 'appt-2',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startAt: new Date('2026-09-18T14:30:00.000Z'),
          holdExpiresAt: futureExpires2,
          conversationId: 'conv-patient-2',
        },
      ]);

      const summary = await service.reconcileHoldsOnStartup({
        nowOverride: simulationNow,
      });

      expect(summary.scannedAppointments).toBe(2);
      expect(summary.restoredLocks).toBe(2);
      expect(summary.synchronizedDoctors).toBe(1);
      expect(summary.removedOrphanLocks).toBe(0);
      expect(summary.clearedStaleCounters).toBe(0);

      // Verify Redis state restored
      const slot1Holder = await service.getHold(
        mockClinicId,
        mockDoctorId,
        '2026-09-18T14:00:00.000Z',
      );
      expect(slot1Holder).toBe('conv-patient-1');

      const slot2Holder = await service.getHold(
        mockClinicId,
        mockDoctorId,
        '2026-09-18T14:30:00.000Z',
      );
      expect(slot2Holder).toBe('conv-patient-2');

      // Doctor counter synchronized to exact count (2)
      const count = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(count).toBe(2);
    });

    it('should purge orphan locks and correct inflated counters on restart', async () => {
      // Setup dirty Redis state before restart:
      // 1. Orphan slot lock that doesn't exist in Postgres
      await mockRedis.set(
        `hold:slot:${mockClinicId}:${mockDoctorId}:2026-09-18T10:00:00.000Z`,
        'conv-orphan',
        300,
      );
      // 2. Inflated doctor counter (value 5 instead of 1)
      await mockRedis.set(
        `hold:count:${mockClinicId}:${mockDoctorId}`,
        '5',
      );
      // 3. Stale counter for a doctor with zero active appointments
      const otherDocId = '99999999-9999-9999-9999-999999999999';
      await mockRedis.set(
        `hold:count:${mockClinicId}:${otherDocId}`,
        '3',
      );

      // Postgres has only 1 valid appointment for mockDoctorId
      prisma.appointment.findMany.mockResolvedValue([
        {
          id: 'appt-valid',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startAt: new Date('2026-09-18T14:00:00.000Z'),
          holdExpiresAt: futureExpires1,
          conversationId: 'conv-valid',
        },
      ]);

      const summary = await service.reconcileHoldsOnStartup({
        nowOverride: simulationNow,
      });

      expect(summary.scannedAppointments).toBe(1);
      expect(summary.restoredLocks).toBe(1);
      expect(summary.removedOrphanLocks).toBe(1);
      expect(summary.clearedStaleCounters).toBe(1);

      // Orphan slot must be deleted
      const orphan = await service.getHold(
        mockClinicId,
        mockDoctorId,
        '2026-09-18T10:00:00.000Z',
      );
      expect(orphan).toBeNull();

      // Valid slot is active
      const valid = await service.getHold(
        mockClinicId,
        mockDoctorId,
        '2026-09-18T14:00:00.000Z',
      );
      expect(valid).toBe('conv-valid');

      // Inflated counter was overwritten and corrected to 1
      const count = await service.getDoctorHoldCount(mockClinicId, mockDoctorId);
      expect(count).toBe(1);

      // Stale counter for other doctor was purged
      const otherCount = await service.getDoctorHoldCount(mockClinicId, otherDocId);
      expect(otherCount).toBe(0);
    });
  });

  describe('6. Lua Script Text Integrity & Contract Tests', () => {
    it('ACQUIRE_HOLD_LUA must contain atomic checks, SET NX EX, and INCR', () => {
      expect(ACQUIRE_HOLD_LUA).toContain('KEYS[1]');
      expect(ACQUIRE_HOLD_LUA).toContain('KEYS[2]');
      expect(ACQUIRE_HOLD_LUA).toContain('ARGV[1]');
      expect(ACQUIRE_HOLD_LUA).toContain('ARGV[2]');
      expect(ACQUIRE_HOLD_LUA).toContain('ARGV[3]');
      expect(ACQUIRE_HOLD_LUA).toContain("MAX_HOLDS_EXCEEDED");
      expect(ACQUIRE_HOLD_LUA).toContain("'NX'");
      expect(ACQUIRE_HOLD_LUA).toContain("'EX'");
      expect(ACQUIRE_HOLD_LUA).toContain("SLOT_ALREADY_LOCKED");
      expect(ACQUIRE_HOLD_LUA).toContain("'INCR'");
      expect(ACQUIRE_HOLD_LUA).toContain("'OK'");
    });

    it('RELEASE_HOLD_LUA must contain ownership check, DEL, and non-negative DECR', () => {
      expect(RELEASE_HOLD_LUA).toContain('KEYS[1]');
      expect(RELEASE_HOLD_LUA).toContain('KEYS[2]');
      expect(RELEASE_HOLD_LUA).toContain('ARGV[1]');
      expect(RELEASE_HOLD_LUA).toContain("'DEL'");
      expect(RELEASE_HOLD_LUA).toContain("'DECR'");
      expect(RELEASE_HOLD_LUA).toContain("if c < 0 then");
    });
  });

  describe('7. OnApplicationBootstrap Lifecycle Hook', () => {
    it('should invoke reconcileHoldsOnStartup on bootstrap and handle failures gracefully', async () => {
      const reconcileSpy = jest
        .spyOn(service, 'reconcileHoldsOnStartup')
        .mockResolvedValue({
          scannedAppointments: 0,
          restoredLocks: 0,
          synchronizedDoctors: 0,
          removedOrphanLocks: 0,
          clearedStaleCounters: 0,
          durationMs: 5,
        });

      await service.onApplicationBootstrap();
      expect(reconcileSpy).toHaveBeenCalled();

      // Test error tolerance (should log error and not throw to prevent bootstrap lock)
      reconcileSpy.mockRejectedValueOnce(new Error('Postgres connection timeout'));
      await expect(service.onApplicationBootstrap()).resolves.not.toThrow();
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to complete startup holds reconciliation'),
        expect.any(String),
        'HoldService',
        expect.any(Object),
      );
    });
  });
});
