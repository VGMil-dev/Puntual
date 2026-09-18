import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { CalendarSyncWorker } from './calendar-sync.worker';
import { HoldModule } from '../holds/hold.module';
import { CalendarModule } from '../calendar/calendar.module';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  imports: [HoldModule, CalendarModule, AvailabilityModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, CalendarSyncWorker],
  exports: [AppointmentsService, CalendarSyncWorker],
})
export class AppointmentsModule {}

