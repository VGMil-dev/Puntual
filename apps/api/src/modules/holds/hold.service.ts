import {
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';

/**
 * Atomic Lua script for acquiring a slot hold.
 * KEYS[1]: slot key (hold:slot:clinicId:doctorId:slotTime)
 * KEYS[2]: doctor hold counter key (hold:count:clinicId:doctorId)
 * ARGV[1]: conversationId
 * ARGV[2]: ttlSeconds
 * ARGV[3]: maxConcurrentHolds
 *
 * Atomicity guarantee (RF-025, CU-001 step 4 & Alt Flow C):
 * 1. Checks current holds >= maxConcurrentHolds -> returns [0, 'MAX_HOLDS_EXCEEDED'] without touching slot
 * 2. SET slotKey conversationId NX EX ttlSeconds
 * 3. If slot already locked -> returns [0, 'SLOT_ALREADY_LOCKED']
 * 4. If acquired -> INCR counterKey and returns [1, 'OK']
 */
export const ACQUIRE_HOLD_LUA = `
local currentHolds = tonumber(redis.call('GET', KEYS[2]) or '0')
if currentHolds >= tonumber(ARGV[3]) then
  return {0, 'MAX_HOLDS_EXCEEDED'}
end

local acquired = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', tonumber(ARGV[2]))
if not acquired then
  return {0, 'SLOT_ALREADY_LOCKED'}
end

redis.call('INCR', KEYS[2])
return {1, 'OK'}
`.trim();

/**
 * Atomic Lua script for releasing a slot hold.
 * KEYS[1]: slot key (hold:slot:clinicId:doctorId:slotTime)
 * KEYS[2]: doctor hold counter key (hold:count:clinicId:doctorId)
 * ARGV[1]: conversationId
 *
 * Atomicity guarantee (RF-025, CU-001 Alt Flow B):
 * If slot owner matches conversationId:
 *   DEL slotKey
 *   DECR counterKey (ensuring not dropping below 0)
 *   returns 1
 * Else:
 *   returns 0
 */
export const RELEASE_HOLD_LUA = `
local owner = redis.call('GET', KEYS[1])
if owner == ARGV[1] then
  redis.call('DEL', KEYS[1])
  local c = redis.call('DECR', KEYS[2])
  if c < 0 then
    redis.call('SET', KEYS[2], '0')
  end
  return 1
else
  return 0
end
`.trim();

export interface AcquireHoldParams {
  clinicId: string;
  doctorId: string;
  startAt: Date | string;
  conversationId: string;
  ttlSeconds?: number;
  maxConcurrentHolds?: number;
  traceId?: string;
  appointmentId?: string;
}

export interface AcquireHoldResult {
  success: boolean;
  reason?: 'OK' | 'MAX_HOLDS_EXCEEDED' | 'SLOT_ALREADY_LOCKED' | string;
  slotKey: string;
  counterKey: string;
  expiresAt: Date;
  ttlSeconds: number;
}

export interface ReleaseHoldParams {
  clinicId: string;
  doctorId: string;
  startAt: Date | string;
  conversationId: string;
  traceId?: string;
  appointmentId?: string;
}

export interface ReleaseHoldResult {
  released: boolean;
  slotKey: string;
  counterKey: string;
}

export interface ReconciliationSummary {
  scannedAppointments: number;
  restoredLocks: number;
  synchronizedDoctors: number;
  removedOrphanLocks: number;
  clearedStaleCounters: number;
  durationMs: number;
}

@Injectable()
export class HoldService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly logger: StructuredLoggerService,
  ) {}

  /**
   * On application bootstrap: reconciles active holds from PostgreSQL into Redis.
   * Restores slot locks with remaining TTL and doctor counters, purging orphan keys.
   */
  async onApplicationBootstrap() {
    try {
      this.logger.log(
        'Executing startup holds reconciliation against Postgres...',
        'HoldService',
      );
      const summary = await this.reconcileHoldsOnStartup();
      this.logger.log(
        'Startup holds reconciliation finished successfully',
        'HoldService',
        summary,
      );
    } catch (error: any) {
      this.logger.error(
        'Failed to complete startup holds reconciliation',
        error?.stack,
        'HoldService',
        { errorMessage: error?.message },
      );
    }
  }

  /**
   * Generates standardized Redis slot lock key.
   * Format: hold:slot:${clinicId}:${doctorId}:${startAtIso}
   */
  getSlotKey(clinicId: string, doctorId: string, startAtIso: string): string {
    return `hold:slot:${clinicId}:${doctorId}:${startAtIso}`;
  }

  /**
   * Generates standardized Redis doctor hold counter key.
   * Format: hold:count:${clinicId}:${doctorId}
   */
  getCounterKey(clinicId: string, doctorId: string): string {
    return `hold:count:${clinicId}:${doctorId}`;
  }

  /**
   * Resolves maxConcurrentHolds hierarchy:
   * 1. Doctor.maxConcurrentHolds (if configured and > 0)
   * 2. Clinic.maxConcurrentHolds (if configured and > 0)
   * 3. Fallback: 3 (default)
   */
  async resolveMaxConcurrentHolds(
    clinicId: string,
    doctorId: string,
  ): Promise<number> {
    const doctor = await this.prisma.doctor.findFirst({
      where: { clinicId, id: doctorId },
      select: {
        id: true,
        maxConcurrentHolds: true,
        clinic: {
          select: { maxConcurrentHolds: true },
        },
      },
    });

    if (!doctor) {
      throw new NotFoundException(
        `Doctor with id ${doctorId} not found in clinic ${clinicId}`,
      );
    }

    if (
      doctor.maxConcurrentHolds !== null &&
      doctor.maxConcurrentHolds !== undefined &&
      doctor.maxConcurrentHolds > 0
    ) {
      return doctor.maxConcurrentHolds;
    }

    if (
      doctor.clinic?.maxConcurrentHolds !== null &&
      doctor.clinic?.maxConcurrentHolds !== undefined &&
      doctor.clinic?.maxConcurrentHolds > 0
    ) {
      return doctor.clinic.maxConcurrentHolds;
    }

    return 3;
  }

  /**
   * Atomically acquires a slot hold using Lua script (RF-025, CU-001 step 4).
   * Prevents race conditions, enforces concurrent hold limit per doctor, and sets TTL.
   */
  async acquireHold(params: AcquireHoldParams): Promise<AcquireHoldResult> {
    const startAtDate =
      typeof params.startAt === 'string'
        ? new Date(params.startAt)
        : params.startAt;
    const startAtIso = startAtDate.toISOString();

    const slotKey = this.getSlotKey(params.clinicId, params.doctorId, startAtIso);
    const counterKey = this.getCounterKey(params.clinicId, params.doctorId);

    const ttl = params.ttlSeconds && params.ttlSeconds > 0 ? params.ttlSeconds : 900;
    const maxHolds =
      params.maxConcurrentHolds && params.maxConcurrentHolds > 0
        ? params.maxConcurrentHolds
        : await this.resolveMaxConcurrentHolds(params.clinicId, params.doctorId);

    const result = await this.redisService.eval(
      ACQUIRE_HOLD_LUA,
      2,
      slotKey,
      counterKey,
      params.conversationId,
      ttl,
      maxHolds,
    );

    const [status, code] = result as [number, string];
    const expiresAt = new Date(Date.now() + ttl * 1000);

    if (Number(status) === 1) {
      this.logger.log(
        `Hold acquired successfully for slot ${startAtIso} on doctor ${params.doctorId}`,
        'HoldService',
        {
          traceId: params.traceId,
          clinicId: params.clinicId,
          doctorId: params.doctorId,
          appointmentId: params.appointmentId,
          conversationId: params.conversationId,
          slotKey,
          counterKey,
          expiresAt: expiresAt.toISOString(),
          ttlSeconds: ttl,
          maxConcurrentHolds: maxHolds,
        },
      );

      return {
        success: true,
        reason: 'OK',
        slotKey,
        counterKey,
        expiresAt,
        ttlSeconds: ttl,
      };
    } else {
      this.logger.warn(
        `Hold acquisition rejected for slot ${startAtIso} on doctor ${params.doctorId}: ${code}`,
        'HoldService',
        {
          traceId: params.traceId,
          clinicId: params.clinicId,
          doctorId: params.doctorId,
          appointmentId: params.appointmentId,
          conversationId: params.conversationId,
          slotKey,
          counterKey,
          reason: code,
          maxConcurrentHolds: maxHolds,
        },
      );

      return {
        success: false,
        reason: code as 'MAX_HOLDS_EXCEEDED' | 'SLOT_ALREADY_LOCKED',
        slotKey,
        counterKey,
        expiresAt,
        ttlSeconds: ttl,
      };
    }
  }

  /**
   * Atomically releases a slot hold using Lua script (RF-025, CU-001 Alt Flow B).
   * Verifies conversationId ownership before deleting slot and decrementing counter.
   */
  async releaseHold(params: ReleaseHoldParams): Promise<ReleaseHoldResult> {
    const startAtDate =
      typeof params.startAt === 'string'
        ? new Date(params.startAt)
        : params.startAt;
    const startAtIso = startAtDate.toISOString();

    const slotKey = this.getSlotKey(params.clinicId, params.doctorId, startAtIso);
    const counterKey = this.getCounterKey(params.clinicId, params.doctorId);

    const result = await this.redisService.eval(
      RELEASE_HOLD_LUA,
      2,
      slotKey,
      counterKey,
      params.conversationId,
    );

    const released = Number(result) === 1;

    if (released) {
      this.logger.log(
        `Hold released successfully for slot ${startAtIso} on doctor ${params.doctorId}`,
        'HoldService',
        {
          traceId: params.traceId,
          clinicId: params.clinicId,
          doctorId: params.doctorId,
          appointmentId: params.appointmentId,
          conversationId: params.conversationId,
          slotKey,
          counterKey,
        },
      );
    } else {
      this.logger.warn(
        `Hold release ignored or conversation mismatch for slot ${startAtIso} on doctor ${params.doctorId}`,
        'HoldService',
        {
          traceId: params.traceId,
          clinicId: params.clinicId,
          doctorId: params.doctorId,
          appointmentId: params.appointmentId,
          conversationId: params.conversationId,
          slotKey,
          counterKey,
        },
      );
    }

    return {
      released,
      slotKey,
      counterKey,
    };
  }

  /**
   * Gets the conversationId currently holding a slot, or null if free.
   */
  async getHold(
    clinicId: string,
    doctorId: string,
    startAt: Date | string,
  ): Promise<string | null> {
    const startAtIso =
      typeof startAt === 'string' ? new Date(startAt).toISOString() : startAt.toISOString();
    const slotKey = this.getSlotKey(clinicId, doctorId, startAtIso);
    return this.redisService.get(slotKey);
  }

  /**
   * Gets the current number of active holds for a doctor from Redis counter.
   */
  async getDoctorHoldCount(clinicId: string, doctorId: string): Promise<number> {
    const counterKey = this.getCounterKey(clinicId, doctorId);
    const val = await this.redisService.get(counterKey);
    return val ? parseInt(val, 10) || 0 : 0;
  }

  /**
   * Reconciles active holds from PostgreSQL (SOLICITADA with holdExpiresAt > NOW())
   * into Redis, restoring slot locks with remaining TTL and exact doctor counters.
   * Purges any orphan slot locks or stale counters.
   */
  async reconcileHoldsOnStartup(options?: {
    clinicId?: string;
    nowOverride?: Date;
  }): Promise<ReconciliationSummary> {
    const startTime = Date.now();
    const now = options?.nowOverride || new Date();

    const whereClause: any = {
      status: AppointmentStatus.SOLICITADA,
      holdExpiresAt: {
        gt: now,
      },
    };

    if (options?.clinicId) {
      whereClause.clinicId = options.clinicId;
    }

    const activeAppointments = await this.prisma.appointment.findMany({
      // bypass-tenant-check: system-wide hold reconciliation on startup across all clinics
      where: whereClause,
      select: {
        id: true,
        clinicId: true,
        doctorId: true,
        startAt: true,
        holdExpiresAt: true,
        conversationId: true,
      },
    });

    const desiredSlots = new Map<string, { conversationId: string; remainingTtl: number }>();
    const doctorHoldCounts = new Map<string, number>();

    for (const appt of activeAppointments) {
      if (!appt.holdExpiresAt) continue;
      const remainingTtl = Math.max(
        1,
        Math.floor((appt.holdExpiresAt.getTime() - now.getTime()) / 1000),
      );
      const startAtIso = appt.startAt.toISOString();
      const slotKey = this.getSlotKey(appt.clinicId, appt.doctorId, startAtIso);
      const counterKey = this.getCounterKey(appt.clinicId, appt.doctorId);
      const conversationId = appt.conversationId || appt.id;

      desiredSlots.set(slotKey, { conversationId, remainingTtl });
      doctorHoldCounts.set(counterKey, (doctorHoldCounts.get(counterKey) || 0) + 1);
    }

    // Inspect existing keys in Redis to clean up orphans or stale counters
    const pattern = options?.clinicId ? `hold:*:${options.clinicId}:*` : 'hold:*';
    let existingKeys: string[] = [];
    try {
      existingKeys = await this.redisService.keys(pattern);
    } catch (err: any) {
      this.logger.warn(
        `Failed to scan existing keys in Redis during reconciliation: ${err?.message}`,
        'HoldService',
      );
    }

    let removedOrphanLocks = 0;
    let clearedStaleCounters = 0;

    for (const key of existingKeys) {
      if (key.startsWith('hold:slot:')) {
        if (!desiredSlots.has(key)) {
          await this.redisService.del(key);
          removedOrphanLocks++;
        }
      } else if (key.startsWith('hold:count:')) {
        if (!doctorHoldCounts.has(key)) {
          await this.redisService.del(key);
          clearedStaleCounters++;
        }
      }
    }

    // Re-establish desired slot locks with remaining TTL
    let restoredLocks = 0;
    for (const [slotKey, { conversationId, remainingTtl }] of desiredSlots.entries()) {
      await this.redisService.set(slotKey, conversationId, remainingTtl);
      restoredLocks++;
    }

    // Synchronize doctor hold counters to exact DB count
    let synchronizedDoctors = 0;
    for (const [counterKey, count] of doctorHoldCounts.entries()) {
      await this.redisService.set(counterKey, String(count));
      synchronizedDoctors++;
    }

    const durationMs = Date.now() - startTime;
    const summary: ReconciliationSummary = {
      scannedAppointments: activeAppointments.length,
      restoredLocks,
      synchronizedDoctors,
      removedOrphanLocks,
      clearedStaleCounters,
      durationMs,
    };

    this.logger.log(
      `Hold reconciliation finished: restored ${restoredLocks} slot locks, synchronized ${synchronizedDoctors} doctors, removed ${removedOrphanLocks} orphan locks, cleared ${clearedStaleCounters} stale counters in ${durationMs}ms`,
      'HoldService',
      summary,
    );

    return summary;
  }
}
