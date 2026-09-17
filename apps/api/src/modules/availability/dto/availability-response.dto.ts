/**
 * Representation of an individual available appointment slot.
 * Timestamps startAt and endAt are formatted as ISO-8601 UTC strings.
 */
export interface SlotDto {
  startAt: string; // ISO 8601 UTC string (e.g. 2026-09-18T14:00:00.000Z)
  endAt: string;   // ISO 8601 UTC string (e.g. 2026-09-18T14:30:00.000Z)
  durationMinutes: number;
}

/**
 * Representation of available slots grouped by date in America/Guayaquil timezone (UTC-5).
 */
export interface DayAvailabilityDto {
  date: string; // YYYY-MM-DD in America/Guayaquil (e.g. 2026-09-18)
  slots: SlotDto[];
}
