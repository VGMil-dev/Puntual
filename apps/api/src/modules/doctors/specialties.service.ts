import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { CreateSpecialtyDto } from './dto/create-specialty.dto';

@Injectable()
export class SpecialtiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async createSpecialty(clinicId: string, dto: CreateSpecialtyDto) {
    const name = dto.name.trim();

    const existing = await this.prisma.specialty.findUnique({
      where: {
        clinicId_name: {
          clinicId,
          name,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Specialty '${name}' already exists in this clinic`);
    }

    const specialty = await this.prisma.specialty.create({
      data: {
        clinicId,
        name,
        defaultSlotDurationMinutes: dto.defaultSlotDurationMinutes || 30,
      },
    });

    this.logger.log(
      `Specialty created: ${specialty.id} (${specialty.name}) for clinic ${clinicId}`,
      'SpecialtiesService',
      { clinicId, specialtyId: specialty.id },
    );

    return specialty;
  }

  async listSpecialties(clinicId: string) {
    return this.prisma.specialty.findMany({
      where: { clinicId },
      include: {
        _count: {
          select: { doctorSpecialties: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async deleteSpecialty(clinicId: string, id: string) {
    const specialty = await this.prisma.specialty.findUnique({
      where: { id },
    });

    if (!specialty) {
      throw new NotFoundException(`Specialty with id ${id} not found`);
    }

    if (specialty.clinicId !== clinicId) {
      throw new ForbiddenException('Cannot delete a specialty belonging to another clinic');
    }

    await this.prisma.specialty.delete({ where: { id } });

    return { message: 'Specialty deleted successfully' };
  }
}
