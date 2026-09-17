import { Body, Controller, Post } from '@nestjs/common';
import {
  AppointmentsService,
  ConfirmAppointmentResult,
} from './appointments.service';
import { ConfirmAppointmentDto } from './dto/confirm-appointment.dto';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';

/**
 * Appointments Controller (CU-001 step 5, RF-010, RF-024, RNF-006, RNF-010, RNF-011).
 * Exposes appointment confirmation endpoints consumed by Chat Gateway and Webhook handlers.
 */
@Controller('internal/appointments')
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  @Post('confirm')
  async confirmAppointment(
    @Body() dto: ConfirmAppointmentDto,
  ): Promise<ConfirmAppointmentResult> {
    this.logger.log(
      'Confirming appointment via internal endpoint',
      'AppointmentsController',
      {
        appointmentId: dto.appointmentId,
        clinicId: dto.clinicId,
        conversationId: dto.conversationId,
      },
    );

    return this.appointmentsService.confirmAppointment(dto);
  }
}
