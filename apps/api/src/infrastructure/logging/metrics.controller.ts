import { Controller, Get, Query } from '@nestjs/common';
import { OperationalLogsService } from './operational-logs.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly operationalLogsService: OperationalLogsService) {}

  @Get('operational')
  async getOperationalMetrics(@Query('clinicId') clinicId?: string) {
    return this.operationalLogsService.getAggregatedMetrics(clinicId);
  }
}
