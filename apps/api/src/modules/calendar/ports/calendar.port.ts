export const CALENDAR_PORT = Symbol('CALENDAR_PORT');

export interface CalendarEventParams {
  calendarId: string;
  refreshTokenCipher: string;
  summary: string;
  description?: string;
  startAt: Date;
  endAt: Date;
}

export interface CalendarPort {
  /**
   * Generates OAuth 2.0 authorization URL for a doctor to grant calendar write access
   */
  generateAuthUrl(doctorId: string, clinicId: string): string;

  /**
   * Exchanges an authorization code for refresh/access tokens
   */
  exchangeCodeForTokens(code: string): Promise<{ refreshToken: string }>;

  /**
   * Validates write access to the doctor's calendar (Checklist piloto #3)
   */
  verifyWritePermissions(calendarId: string, refreshTokenCipher: string): Promise<boolean>;

  /**
   * Creates an event in Google Calendar (Puntual -> Calendar only)
   */
  createEvent(params: CalendarEventParams): Promise<string>;

  /**
   * Updates an existing event
   */
  updateEvent(eventId: string, params: CalendarEventParams): Promise<void>;

  /**
   * Deletes or cancels an existing event
   */
  deleteEvent(eventId: string, calendarId: string, refreshTokenCipher: string): Promise<void>;
}
