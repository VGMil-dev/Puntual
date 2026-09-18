import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { GetAvailabilityDto } from './dto/get-availability.dto';
import { DayAvailabilityDto, SlotDto } from './dto/availability-response.dto';

const TIMEZONE = 'America/Guayaquil';
const TIMEZONE_OFFSET_HOURS = -5; // UTC-5 (no DST in Ecuador)

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLoggerService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Resolves slot duration according to strict hierarchy (RF-029, E1.5):
   * 1. Doctor.slotDurationMinutes
   * 2. Specialty.defaultSlotDurationMinutes
   * 3. Clinic.defaultSlotDurationMinutes
   * Fallback: 30 minutes.
   */
  async resolveSlotDuration(params: {
    clinicId: string;
    doctorId: string;
    specialtyId?: string;
    motivo?: string;
  }): Promise<number> {
    const { clinicId, doctorId, specialtyId, motivo } = params;

    // 1. Doctor override
    const doctor = await this.prisma.doctor.findFirst({
      where: { clinicId, id: doctorId },
      select: { slotDurationMinutes: true },
    });

    if (doctor?.slotDurationMinutes && doctor.slotDurationMinutes > 0) {
      return doctor.slotDurationMinutes;
    }

    // 2. Specialty override (via specialtyId or motivo name)
    const specialtyIdentifier = specialtyId || motivo;
    if (specialtyIdentifier) {
      const specialty = await this.prisma.specialty.findFirst({
        where: {
          clinicId,
          OR: [
            { id: specialtyIdentifier },
            { name: { equals: specialtyIdentifier, mode: 'insensitive' } },
          ],
        },
        select: { defaultSlotDurationMinutes: true },
      });

      if (
        specialty?.defaultSlotDurationMinutes &&
        specialty.defaultSlotDurationMinutes > 0
      ) {
        return specialty.defaultSlotDurationMinutes;
      }
    }

    // 3. Clinic default
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { defaultSlotDurationMinutes: true },
    });

    if (
      clinic?.defaultSlotDurationMinutes &&
      clinic.defaultSlotDurationMinutes > 0
    ) {
      return clinic.defaultSlotDurationMinutes;
    }

    return 30;
  }

  /**
   * Calculates available slots for a given date range in America/Guayaquil timezone (UTC-5).
   * Excludes past slots, confirmed appointments, and active holds from other conversations.
   * Allows same-conversation holds and releases slots if holdExpiresAt <= NOW().
   */
  async getAvailability(
    query: GetAvailabilityDto,
    nowOverride?: Date,
  ): Promise<DayAvailabilityDto[]> {
    const now = nowOverride || new Date();
    const { clinicId, doctorId, specialtyId, motivo, conversationId } = query;

    // Validate doctor existence in target clinic (RNF-001)
    const doctor = await this.prisma.doctor.findFirst({
      where: { clinicId, id: doctorId },
      select: { id: true, name: true, slotDurationMinutes: true },
    });

    if (!doctor) {
      throw new NotFoundException(
        `Doctor with id ${doctorId} not found in clinic ${clinicId}`,
      );
    }

    // Parse and validate date range in America/Guayaquil
    const startDateStr = this.normalizeToGuayaquilDate(query.startDate);
    const endDateStr = this.normalizeToGuayaquilDate(query.endDate || query.startDate);
    const dateList = this.buildDateRange(startDateStr, endDateStr);

    // Resolve slot duration using hierarchy (RF-029)
    const durationMinutes = await this.resolveSlotDuration({
      clinicId,
      doctorId,
      specialtyId,
      motivo,
    });

    // Compute UTC boundaries for the entire date range to batch query appointments
    const rangeStartUtc = new Date(`${dateList[0]}T00:00:00-05:00`);
    const lastDate = dateList[dateList.length - 1];
    const [endY, endM, endD] = lastDate.split('-').map(Number);
    const nextDayUtc = new Date(Date.UTC(endY, endM - 1, endD + 1, 12, 0, 0));
    const nextDayStr = `${nextDayUtc.getUTCFullYear()}-${String(nextDayUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDayUtc.getUTCDate()).padStart(2, '0')}`;
    const rangeEndUtc = new Date(`${nextDayStr}T00:00:00-05:00`);

    // Fetch existing appointments (CONFIRMADA and SOLICITADA) for this doctor and clinic
    const appointments = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        doctorId,
        status: {
          in: [AppointmentStatus.CONFIRMADA, AppointmentStatus.SOLICITADA],
        },
        startAt: { lt: rangeEndUtc },
        endAt: { gt: rangeStartUtc },
      },
    });

    const result: DayAvailabilityDto[] = [];

    for (const dateStr of dateList) {
      const daySlots = await this.calculateSlotsForSingleDate({
        clinicId,
        doctorId,
        dateStr,
        durationMinutes,
        appointments,
        now,
        conversationId,
      });

      result.push({
        date: dateStr,
        slots: daySlots,
      });
    }

    this.logger.log(
      `Calculated availability for doctor ${doctorId} across ${dateList.length} day(s): ${result.reduce((acc, d) => acc + d.slots.length, 0)} slots available`,
      'AvailabilityService',
      {
        clinicId,
        doctorId,
        startDate: startDateStr,
        endDate: endDateStr,
        durationMinutes,
        totalSlots: result.reduce((acc, d) => acc + d.slots.length, 0),
      },
    );

    return result;
  }

  /**
   * Helper to get availability for a single date.
   */
  async getAvailabilityForDate(
    clinicId: string,
    doctorId: string,
    date: string,
    options?: {
      specialtyId?: string;
      motivo?: string;
      conversationId?: string;
      now?: Date;
    },
  ): Promise<DayAvailabilityDto> {
    const results = await this.getAvailability(
      {
        clinicId,
        doctorId,
        startDate: date,
        endDate: date,
        specialtyId: options?.specialtyId,
        motivo: options?.motivo,
        conversationId: options?.conversationId,
      },
      options?.now,
    );

    return results[0];
  }

  /**
   * Calculates available slots for a single local date (YYYY-MM-DD in America/Guayaquil).
   */
  private async calculateSlotsForSingleDate(params: {
    clinicId: string;
    doctorId: string;
    dateStr: string;
    durationMinutes: number;
    appointments: Array<{
      status: AppointmentStatus;
      startAt: Date;
      endAt: Date;
      holdExpiresAt: Date | null;
      conversationId?: string | null;
      reason: string | null;
    }>;
    now: Date;
    conversationId?: string;
  }): Promise<SlotDto[]> {
    const {
      clinicId,
      doctorId,
      dateStr,
      durationMinutes,
      appointments,
      now,
      conversationId,
    } = params;

    const dayOfWeek = this.getDayOfWeek(dateStr);

    // Fetch doctor's working schedule for this day of the week
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: {
        clinicId,
        doctorId,
        dayOfWeek,
      },
      orderBy: { startTime: 'asc' },
    });

    if (!schedules || schedules.length === 0) {
      return [];
    }

    const baseGuayaquilMidnightUtc = new Date(`${dateStr}T00:00:00-05:00`);
    const availableSlots: SlotDto[] = [];

    for (const schedule of schedules) {
      const startMinutes = this.timeStringToMinutes(schedule.startTime);
      const endMinutes = this.timeStringToMinutes(schedule.endTime);

      let currentMinute = startMinutes;
      while (currentMinute + durationMinutes <= endMinutes) {
        const slotStart = new Date(
          baseGuayaquilMidnightUtc.getTime() + currentMinute * 60 * 1000,
        );
        const slotEnd = new Date(
          baseGuayaquilMidnightUtc.getTime() +
            (currentMinute + durationMinutes) * 60 * 1000,
        );

        // Filter 1: Discard slots in the past relative to NOW()
        if (slotStart.getTime() <= now.getTime()) {
          currentMinute += durationMinutes;
          continue;
        }

        // Filter 2: Check Redis hold if Redis is configured
        let blockedByRedis = false;
        if (this.redis) {
          const redisKey = `hold:slot:${clinicId}:${doctorId}:${slotStart.toISOString()}`;
          const redisHolder = await this.redis.get(redisKey);
          if (redisHolder) {
            // If held by another conversation, it is blocked
            if (!conversationId || redisHolder !== conversationId) {
              blockedByRedis = true;
            }
          }
        }

        if (blockedByRedis) {
          currentMinute += durationMinutes;
          continue;
        }

        // Filter 3: Check database appointments
        const blockedByDbAppointment = appointments.some((appt) => {
          // Check slot overlap: startAt < slotEnd && endAt > slotStart
          const overlaps =
            appt.startAt.getTime() < slotEnd.getTime() &&
            appt.endAt.getTime() > slotStart.getTime();

          if (!overlaps) {
            return false;
          }

          // Case A: CONFIRMADA appointment always blocks
          if (appt.status === AppointmentStatus.CONFIRMADA) {
            return true;
          }

          // Case B: SOLICITADA appointment
          if (appt.status === AppointmentStatus.SOLICITADA) {
            // Check hold expiration: if holdExpiresAt <= NOW(), hold has expired -> does NOT block
            const isHoldActive =
              appt.holdExpiresAt && appt.holdExpiresAt.getTime() > now.getTime();

            if (!isHoldActive) {
              return false; // Hold expired, slot is released
            }

            // Hold is active: check if it belongs to the same conversation
            const isSameConversation =
              Boolean(conversationId) &&
              appt.conversationId === conversationId;

            if (isSameConversation) {
              return false; // Same conversation hold does not block itself
            }

            return true; // Active hold from another conversation blocks
          }

          return false;
        });

        if (!blockedByDbAppointment) {
          availableSlots.push({
            startAt: slotStart.toISOString(),
            endAt: slotEnd.toISOString(),
            durationMinutes,
          });
        }

        currentMinute += durationMinutes;
      }
    }

    return availableSlots;
  }

  /**
   * Normalizes an ISO string or YYYY-MM-DD date string to a canonical YYYY-MM-DD in America/Guayaquil.
   */
  private normalizeToGuayaquilDate(input: string): string {
    if (!input || typeof input !== 'string') {
      throw new BadRequestException('Date parameter is required');
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      return input;
    }

    const parsed = new Date(input);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Invalid date format: "${input}". Expected ISO string or YYYY-MM-DD`,
      );
    }

    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed);
  }

  /**
   * Generates a list of all YYYY-MM-DD dates in the range [startDateStr, endDateStr] inclusive.
   */
  private buildDateRange(startDateStr: string, endDateStr: string): string[] {
    const [sY, sM, sD] = startDateStr.split('-').map(Number);
    const [eY, eM, eD] = endDateStr.split('-').map(Number);

    const startUtc = new Date(Date.UTC(sY, sM - 1, sD, 12, 0, 0));
    const endUtc = new Date(Date.UTC(eY, eM - 1, eD, 12, 0, 0));

    if (startUtc.getTime() > endUtc.getTime()) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }

    const diffDays = Math.round(
      (endUtc.getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (diffDays > 60) {
      throw new BadRequestException('Date range cannot exceed 60 days');
    }

    const dates: string[] = [];
    const current = new Date(startUtc);

    while (current.getTime() <= endUtc.getTime()) {
      const y = current.getUTCFullYear();
      const m = String(current.getUTCMonth() + 1).padStart(2, '0');
      const d = String(current.getUTCDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
  }

  /**
   * Returns day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday) for a YYYY-MM-DD date in America/Guayaquil.
   */
  private getDayOfWeek(dateStr: string): number {
    const [year, month, day] = dateStr.split('-').map(Number);
    const dateUtcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return dateUtcNoon.getUTCDay();
  }

  /**
   * Converts a "HH:mm" time string into total minutes since start of day.
   */
  private timeStringToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }
}
