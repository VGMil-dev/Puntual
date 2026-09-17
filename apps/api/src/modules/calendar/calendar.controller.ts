import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('oauth/url')
  @UseGuards(JwtAuthGuard)
  async getOAuthUrl(@Query('doctorId') doctorId: string, @CurrentUser() user: any) {
    if (!doctorId) {
      throw new BadRequestException('doctorId query parameter is required');
    }
    return this.calendarService.getOAuthUrl(doctorId, user.clinicId);
  }

  @Get('oauth/callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    if (!code || !state) {
      throw new BadRequestException('code and state are required in OAuth callback');
    }
    return this.calendarService.handleOAuthCallback(code, state);
  }

  @Post('verify/:doctorId')
  @UseGuards(JwtAuthGuard)
  async verifyDoctorCalendar(
    @Param('doctorId') doctorId: string,
    @CurrentUser() user: any,
  ) {
    return this.calendarService.verifyDoctorCalendar(doctorId, user.clinicId);
  }
}
