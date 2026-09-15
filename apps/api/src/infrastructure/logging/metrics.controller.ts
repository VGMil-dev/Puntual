import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { OperationalLogsService } from './operational-logs.service';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../modules/auth/guards/roles.guard';
import { Roles } from '../../modules/auth/decorators/roles.decorator';
import { CurrentUser } from '../../modules/auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('metrics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MetricsController {
  constructor(private readonly operationalLogsService: OperationalLogsService) {}

  @Get('operational')
  @Roles(UserRole.SUPER_ADMIN, UserRole.CLINIC_ADMIN)
  async getOperationalMetrics(
    @CurrentUser() user: { id: string; role: UserRole; clinicId?: string },
    @Query('clinicId') clinicId?: string,
  ) {
    if (user.role === UserRole.CLINIC_ADMIN) {
      if (clinicId && clinicId !== user.clinicId) {
        throw new ForbiddenException('Cannot access metrics from another clinic');
      }
      return this.operationalLogsService.getAggregatedMetrics(user.clinicId);
    }

    // Super Admin can view global metrics or any clinic's metrics (RF-004)
    return this.operationalLogsService.getAggregatedMetrics(clinicId);
  }
}
