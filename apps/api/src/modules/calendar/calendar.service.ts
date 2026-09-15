import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { ChannelsService } from '../channels/channels.service';
import { CALENDAR_PORT, CalendarPort } from './ports/calendar.port';

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelsService: ChannelsService,
    private readonly logger: StructuredLoggerService,
    @Inject(CALENDAR_PORT) private readonly calendarPort: CalendarPort,
  ) {}

  async getOAuthUrl(doctorId: string, clinicId: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id: doctorId, clinicId },
    });

    if (!doctor) {
      throw new NotFoundException(`Doctor with id ${doctorId} not found in this clinic`);
    }

    const url = this.calendarPort.generateAuthUrl(doctorId, clinicId);
    return { url };
  }

  async handleOAuthCallback(code: string, state: string) {
    let doctorId: string;
    let clinicId: string;

    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      doctorId = decoded.doctorId;
      clinicId = decoded.clinicId;
    } catch {
      throw new BadRequestException('Invalid OAuth state parameter');
    }

    const doctor = await this.prisma.doctor.findFirst({
      where: { id: doctorId, clinicId },
    });

    if (!doctor) {
      throw new NotFoundException('Doctor referenced in OAuth callback not found');
    }

    const { refreshToken } = await this.calendarPort.exchangeCodeForTokens(code);
    const refreshTokenCipher = this.channelsService.encryptToken(refreshToken);

    const calendarId = 'primary';
    let writeVerified = false;

    try {
      writeVerified = await this.calendarPort.verifyWritePermissions(calendarId, refreshTokenCipher);
    } catch (err: any) {
      this.logger.warn(`Could not verify calendar write permission: ${err.message}`, 'CalendarService');
    }

    await this.prisma.doctor.update({
      where: { id: doctorId },
      data: {
        googleCalendarId: calendarId,
        googleRefreshTokenCipher: refreshTokenCipher,
        googleCalendarWriteVerifiedAt: writeVerified ? new Date() : null,
      },
    });

    this.logger.log(
      `Doctor ${doctorId} connected Google Calendar (writeVerified: ${writeVerified})`,
      'CalendarService',
      { doctorId, clinicId, writeVerified },
    );

    return {
      doctorId,
      calendarConnected: true,
      writePermissionsVerified: writeVerified,
    };
  }

  async verifyDoctorCalendar(doctorId: string, clinicId: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id: doctorId, clinicId },
    });

    if (!doctor) {
      throw new NotFoundException(`Doctor with id ${doctorId} not found`);
    }

    if (!doctor.googleRefreshTokenCipher || !doctor.googleCalendarId) {
      throw new BadRequestException('Doctor has not connected a Google Calendar');
    }

    const isValid = await this.calendarPort.verifyWritePermissions(
      doctor.googleCalendarId,
      doctor.googleRefreshTokenCipher,
    );

    if (isValid) {
      await this.prisma.doctor.update({
        where: { id: doctorId },
        data: { googleCalendarWriteVerifiedAt: new Date() },
      });
    }

    return {
      doctorId,
      writeVerified: isValid,
    };
  }
}
