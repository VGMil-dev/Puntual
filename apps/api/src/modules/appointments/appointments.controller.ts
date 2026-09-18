import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import {
  AppointmentsService,
  ConfirmAppointmentResult,
  BookAppointmentResult,
} from './appointments.service';
import { ConfirmAppointmentDto } from './dto/confirm-appointment.dto';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';

/**
 * Appointments Controller (Ticket E2.2b-bis / CU-001 steps 4-6, RF-010, RF-024, RF-025, RF-029, RNF-001, RNF-006, RNF-010, RNF-011).
 * Exposes appointment booking and confirmation endpoints consumed by Chat Gateway and Webhook handlers.
 */
@Controller('internal/appointments')
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  @Post('book')
  async bookAppointment(
    @Body() dto: BookAppointmentDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<BookAppointmentResult> {
    this.logger.log(
      'Booking appointment via internal endpoint',
      'AppointmentsController',
      {
        clinicId: dto.clinicId,
        doctorId: dto.doctorId,
        patientId: dto.patientId,
        conversationId: dto.conversationId,
        startAt: dto.startAt,
      },
    );

    const result = await this.appointmentsService.bookAppointment(dto);
    if (res?.status) {
      res.status(
        result.isIdempotentReplay ? HttpStatus.OK : HttpStatus.CREATED,
      );
    }
    return result;
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
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
