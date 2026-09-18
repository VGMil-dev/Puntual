import {
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { HoldService } from './hold.service';
import { AcquireHoldDto } from './dto/acquire-hold.dto';
import { ReleaseHoldDto } from './dto/release-hold.dto';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';

/**
 * Internal Holds Controller (CU-001 step 4, RF-025, RNF-010).
 * Exposes atomic distributed hold management endpoints consumed internally by AI Agent / Chat Gateway.
 */
@Controller('internal/holds')
export class HoldController {
  constructor(
    private readonly holdService: HoldService,
    private readonly logger: StructuredLoggerService,
  ) {}

  @Post('acquire')
  async acquireHold(@Body() dto: AcquireHoldDto) {
    this.logger.log('Acquiring slot hold via internal endpoint', 'HoldController', {
      clinicId: dto.clinicId,
      doctorId: dto.doctorId,
      startAt: dto.startAt,
      conversationId: dto.conversationId,
    });

    return this.holdService.acquireHold(dto);
  }

  @Post('release')
  async releaseHold(@Body() dto: ReleaseHoldDto) {
    this.logger.log('Releasing slot hold via internal endpoint', 'HoldController', {
      clinicId: dto.clinicId,
      doctorId: dto.doctorId,
      startAt: dto.startAt,
      conversationId: dto.conversationId,
    });

    return this.holdService.releaseHold(dto);
  }

  @Get('doctor-count')
  async getDoctorHoldCount(
    @Query('clinicId') clinicId: string,
    @Query('doctorId') doctorId: string,
  ) {
    const count = await this.holdService.getDoctorHoldCount(clinicId, doctorId);
    return { clinicId, doctorId, count };
  }

  @Post('reconcile')
  async reconcileHolds(@Query('clinicId') clinicId?: string) {
    this.logger.log('Triggering manual holds reconciliation', 'HoldController', {
      clinicId,
    });
    return this.holdService.reconcileHoldsOnStartup({ clinicId });
  }
}
