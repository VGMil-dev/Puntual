import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClinicsService } from './clinics.service';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('clinics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  async createClinic(@Body() dto: CreateClinicDto) {
    return this.clinicsService.createClinic(dto);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  async listClinics() {
    return this.clinicsService.listClinics();
  }

  @Get(':id')
  async getClinic(@Param('id') id: string, @CurrentUser() user: any) {
    // Super Admin can view any clinic; Clinic Admin or Doctor can only view their own clinic (RNF-001 / BOLA prevention)
    if (user.role !== UserRole.SUPER_ADMIN && user.clinicId !== id) {
      throw new ForbiddenException('Access to clinic tenant data is restricted to members of this clinic');
    }
    return this.clinicsService.getClinicById(id);
  }
}
