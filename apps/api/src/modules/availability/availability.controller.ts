import { Controller, Get, Query } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { GetAvailabilityDto } from './dto/get-availability.dto';
import { DayAvailabilityDto } from './dto/availability-response.dto';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';

/**
 * Internal Availability Controller (CU-001 step 3, RF-029, RF-025, RNF-010).
 * Exposes internal endpoint for slot calculation consumed by Channel Gateway / AI Agent.
 * Not exposed directly to the public web without gateway mediation.
 */
@Controller('internal/disponibilidad')
export class AvailabilityController {
  constructor(
    private readonly availabilityService: AvailabilityService,
    private readonly logger: StructuredLoggerService,
  ) {}

  @Get()
  async getAvailability(
    @Query() query: GetAvailabilityDto,
  ): Promise<DayAvailabilityDto[]> {
    this.logger.log('Querying internal availability slots', 'AvailabilityController', {
      clinicId: query.clinicId,
      doctorId: query.doctorId,
      startDate: query.startDate,
      endDate: query.endDate,
      specialtyId: query.specialtyId,
      motivo: query.motivo,
      conversationId: query.conversationId,
    });

    return this.availabilityService.getAvailability(query);
  }
}
