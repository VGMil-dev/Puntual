import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('doctors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Post()
  @Roles(UserRole.CLINIC_ADMIN, UserRole.SUPER_ADMIN)
  async createDoctor(
    @CurrentUser() user: any,
    @Body() dto: CreateDoctorDto,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const clinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!clinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.doctorsService.createDoctor(clinicId, dto);
  }

  @Get()
  async listDoctors(
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

    return this.doctorsService.listDoctors(clinicId);
  }

  @Get('by-specialty/:specialty')
  async findBySpecialty(
    @CurrentUser() user: any,
    @Param('specialty') specialty: string,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const clinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!clinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.doctorsService.findDoctorsBySpecialty(clinicId, specialty);
  }

  @Get(':id')
  async getDoctor(
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

    return this.doctorsService.getDoctorById(clinicId, id);
  }

  @Put(':id')
  @Roles(UserRole.CLINIC_ADMIN, UserRole.SUPER_ADMIN)
  async updateDoctor(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateDoctorDto,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const clinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!clinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.doctorsService.updateDoctor(clinicId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.CLINIC_ADMIN, UserRole.SUPER_ADMIN)
  async deleteDoctor(
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

    return this.doctorsService.deleteDoctor(clinicId, id);
  }

  @Post(':id/schedules')
  @Roles(UserRole.CLINIC_ADMIN, UserRole.SUPER_ADMIN)
  async addSchedule(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateScheduleDto,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const clinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!clinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.doctorsService.addSchedule(clinicId, id, dto);
  }

  @Get(':id/schedules')
  async getSchedules(
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

    return this.doctorsService.getDoctorSchedules(clinicId, id);
  }

  @Delete(':id/schedules/:scheduleId')
  @Roles(UserRole.CLINIC_ADMIN, UserRole.SUPER_ADMIN)
  async deleteSchedule(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('scheduleId') scheduleId: string,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const clinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!clinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.doctorsService.deleteSchedule(clinicId, id, scheduleId);
  }
}
