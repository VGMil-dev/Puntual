import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { HoldModule } from '../holds/hold.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [HoldModule, CalendarModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
