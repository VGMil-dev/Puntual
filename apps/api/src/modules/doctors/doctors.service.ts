import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';

@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async createDoctor(clinicId: string, dto: CreateDoctorDto) {
    const specialtyIds = dto.specialtyIds || [];

    // Verify all specialties belong to this clinic
    if (specialtyIds.length > 0) {
      const count = await this.prisma.specialty.count({
        where: {
          id: { in: specialtyIds },
          clinicId,
        },
      });
      if (count !== specialtyIds.length) {
        throw new BadRequestException('One or more specialtyIds are invalid or do not belong to this clinic');
      }
    }

    const doctor = await this.prisma.doctor.create({
      data: {
        clinicId,
        name: dto.name,
        email: dto.email,
        slotDurationMinutes: dto.slotDurationMinutes,
        maxConcurrentHolds: dto.maxConcurrentHolds,
        doctorSpecialties: {
          create: specialtyIds.map((specialtyId) => ({
            specialty: { connect: { id: specialtyId } },
          })),
        },
      },
      include: {
        doctorSpecialties: {
          include: { specialty: true },
        },
      },
    });

    this.logger.log(`Doctor created: ${doctor.id} (${doctor.name}) for clinic ${clinicId}`, 'DoctorsService', {
      clinicId,
      doctorId: doctor.id,
    });

    return doctor;
  }

  async updateDoctor(clinicId: string, doctorId: string, dto: UpdateDoctorDto) {
    const existing = await this.prisma.doctor.findFirst({
      where: { id: doctorId, clinicId },
    });

    if (!existing) {
      throw new NotFoundException(`Doctor with id ${doctorId} not found in this clinic`);
    }

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.slotDurationMinutes !== undefined) updateData.slotDurationMinutes = dto.slotDurationMinutes;
    if (dto.maxConcurrentHolds !== undefined) updateData.maxConcurrentHolds = dto.maxConcurrentHolds;

    if (dto.specialtyIds !== undefined) {
      // Validate specialties
      if (dto.specialtyIds.length > 0) {
        const count = await this.prisma.specialty.count({
          where: {
            id: { in: dto.specialtyIds },
            clinicId,
          },
        });
        if (count !== dto.specialtyIds.length) {
          throw new BadRequestException('One or more specialtyIds are invalid or do not belong to this clinic');
        }
      }

      // Re-link specialties in transaction
      await this.prisma.$transaction([
        this.prisma.doctorSpecialty.deleteMany({ where: { doctorId } }),
        this.prisma.doctorSpecialty.createMany({
          data: dto.specialtyIds.map((specialtyId) => ({
            doctorId,
            specialtyId,
          })),
        }),
      ]);
    }

    const updated = await this.prisma.doctor.update({
      where: { id: doctorId },
      data: updateData,
      include: {
        doctorSpecialties: {
          include: { specialty: true },
        },
      },
    });

    return updated;
  }

  async getDoctorById(clinicId: string, doctorId: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id: doctorId, clinicId },
      include: {
        doctorSpecialties: {
          include: { specialty: true },
        },
        schedules: {
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        },
      },
    });

    if (!doctor) {
      throw new NotFoundException(`Doctor with id ${doctorId} not found in this clinic`);
    }

    return doctor;
  }

  async listDoctors(clinicId: string) {
    return this.prisma.doctor.findMany({
      where: { clinicId },
      include: {
        doctorSpecialties: {
          include: { specialty: true },
        },
        schedules: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async deleteDoctor(clinicId: string, doctorId: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id: doctorId, clinicId },
    });

    if (!doctor) {
      throw new NotFoundException(`Doctor with id ${doctorId} not found in this clinic`);
    }

    await this.prisma.doctor.delete({ where: { id: doctorId } });

    return { message: 'Doctor deleted successfully' };
  }

  async addSchedule(clinicId: string, doctorId: string, dto: CreateScheduleDto) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id: doctorId, clinicId },
    });

    if (!doctor) {
      throw new NotFoundException(`Doctor with id ${doctorId} not found in this clinic`);
    }

    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException('startTime must be strictly before endTime');
    }

    const schedule = await this.prisma.doctorSchedule.create({
      data: {
        clinicId,
        doctorId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        slotDurationMinutes: dto.slotDurationMinutes,
      },
    });

    this.logger.log(
      `Schedule created for doctor ${doctorId}: Day ${dto.dayOfWeek} [${dto.startTime}-${dto.endTime}]`,
      'DoctorsService',
      { clinicId, doctorId, scheduleId: schedule.id },
    );

    return schedule;
  }

  async getDoctorSchedules(clinicId: string, doctorId: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id: doctorId, clinicId },
    });

    if (!doctor) {
      throw new NotFoundException(`Doctor with id ${doctorId} not found in this clinic`);
    }

    return this.prisma.doctorSchedule.findMany({
      where: { clinicId, doctorId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async deleteSchedule(clinicId: string, doctorId: string, scheduleId: string) {
    const schedule = await this.prisma.doctorSchedule.findFirst({
      where: { id: scheduleId, clinicId, doctorId },
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule with id ${scheduleId} not found`);
    }

    await this.prisma.doctorSchedule.delete({ where: { id: scheduleId } });

    return { message: 'Schedule deleted successfully' };
  }

  /**
   * Resolves effective slot duration according to hierarchy (RF-029):
   * 1. Doctor override
   * 2. Specialty override
   * 3. Clinic default (30 min)
   */
  async resolveSlotDuration(params: {
    clinicId: string;
    doctorId: string;
    specialtyId?: string;
  }): Promise<number> {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id: params.doctorId, clinicId: params.clinicId },
      select: { slotDurationMinutes: true },
    });

    if (doctor?.slotDurationMinutes) {
      return doctor.slotDurationMinutes;
    }

    if (params.specialtyId) {
      const specialty = await this.prisma.specialty.findFirst({
        where: { id: params.specialtyId, clinicId: params.clinicId },
        select: { defaultSlotDurationMinutes: true },
      });
      if (specialty?.defaultSlotDurationMinutes) {
        return specialty.defaultSlotDurationMinutes;
      }
    }

    const clinic = await this.prisma.clinic.findUnique({
      where: { id: params.clinicId },
      select: { defaultSlotDurationMinutes: true },
    });

    return clinic?.defaultSlotDurationMinutes || 30;
  }

  /**
   * Cross-reference helper used by E2.1 agent to find doctors matching a specialty
   */
  async findDoctorsBySpecialty(clinicId: string, specialtyNameOrId: string) {
    return this.prisma.doctor.findMany({
      where: {
        clinicId,
        doctorSpecialties: {
          some: {
            OR: [
              { specialtyId: specialtyNameOrId },
              {
                specialty: {
                  name: {
                    equals: specialtyNameOrId,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          },
        },
      },
      include: {
        doctorSpecialties: {
          include: { specialty: true },
        },
        schedules: true,
      },
    });
  }
}
