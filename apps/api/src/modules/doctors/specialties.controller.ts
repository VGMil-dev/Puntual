import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { SpecialtiesService } from './specialties.service';
import { CreateSpecialtyDto } from './dto/create-specialty.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('specialties')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SpecialtiesController {
  constructor(private readonly specialtiesService: SpecialtiesService) {}

  @Post()
  @Roles(UserRole.CLINIC_ADMIN, UserRole.SUPER_ADMIN)
  async createSpecialty(
    @CurrentUser() user: any,
    @Body() dto: CreateSpecialtyDto,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const clinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!clinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.specialtiesService.createSpecialty(clinicId, dto);
  }

  @Get()
  async listSpecialties(
    @CurrentUser() user: any,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const clinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!clinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.specialtiesService.listSpecialties(clinicId);
  }

  @Delete(':id')
  @Roles(UserRole.CLINIC_ADMIN, UserRole.SUPER_ADMIN)
  async deleteSpecialty(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const clinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!clinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.specialtiesService.deleteSpecialty(clinicId, id);
  }
}
