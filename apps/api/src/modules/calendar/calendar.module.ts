import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';
import { GoogleCalendarAdapter } from './adapters/google-calendar.adapter';
import { CALENDAR_PORT } from './ports/calendar.port';
import { ChannelsModule } from '../channels/channels.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ChannelsModule, AuthModule],
  controllers: [CalendarController],
  providers: [
    CalendarService,
    GoogleCalendarAdapter,
    {
      provide: CALENDAR_PORT,
      useExisting: GoogleCalendarAdapter,
    },
  ],
  exports: [CalendarService, CALENDAR_PORT],
})
export class CalendarModule {}
