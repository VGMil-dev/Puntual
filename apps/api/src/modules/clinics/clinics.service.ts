import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { AuthService } from '../auth/auth.service';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { PlanType, SubscriptionStatus } from '@prisma/client';

@Injectable()
export class ClinicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async createClinic(dto: CreateClinicDto) {
    const slug = dto.slug.toLowerCase().trim();

    const existingClinic = await this.prisma.clinic.findUnique({
      where: { slug },
    });
    if (existingClinic) {
      throw new ConflictException(`Clinic with slug '${slug}' already exists`);
    }

    const planType = dto.planType || PlanType.TRIAL;
    const isTrial = planType === PlanType.TRIAL;
    const trialDays = dto.trialDays || 14;

    const trialEndsAt = isTrial
      ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
      : null;

    const subscriptionStatus = isTrial
      ? SubscriptionStatus.TRIAL
      : SubscriptionStatus.ACTIVE;

    // Transaction to create Clinic, Subscription and Clinic Admin
    return this.prisma.$transaction(async (tx) => {
      const clinic = await tx.clinic.create({
        data: {
          name: dto.name,
          slug,
          subscriptionStatus,
          trialEndsAt,
          gracePeriodDays: 5,
        },
      });

      const subscription = await tx.subscription.create({
        data: {
          clinicId: clinic.id,
          planType,
          status: subscriptionStatus,
          trialEndsAt,
          currentPeriodEnd: !isTrial
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            : null,
          gracePeriodDays: 5,
        },
      });

      // Create Clinic Admin user within transaction
      const adminResult = await this.authService.createClinicAdmin(
        {
          clinicId: clinic.id,
          name: dto.adminName,
          email: dto.adminEmail,
          password: dto.adminPassword,
        },
        tx,
      );

      this.logger.log(`New clinic tenant created: ${clinic.id} (${clinic.name})`, 'ClinicsService', {
        clinicId: clinic.id,
        planType,
        subscriptionStatus,
        isTrial,
      });

      return {
        clinic: {
          id: clinic.id,
          name: clinic.name,
          slug: clinic.slug,
          subscriptionStatus: clinic.subscriptionStatus,
          trialEndsAt: clinic.trialEndsAt,
          createdAt: clinic.createdAt,
        },
        subscription: {
          id: subscription.id,
          planType: subscription.planType,
          status: subscription.status,
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodEnd: subscription.currentPeriodEnd,
        },
        admin: adminResult.user,
        initialPassword: adminResult.initialPassword,
      };
    });
  }

  async getClinicById(id: string) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id },
      include: {
        subscription: true,
        specialties: true,
        doctors: {
          select: {
            id: true,
            name: true,
            email: true,
            specialties: true,
            slotDurationMinutes: true,
            googleCalendarId: true,
          },
        },
      },
    });

    if (!clinic) {
      throw new NotFoundException(`Clinic with id ${id} not found`);
    }

    return clinic;
  }

  async listClinics() {
    return this.prisma.clinic.findMany({
      include: {
        subscription: true,
        _count: {
          select: {
            doctors: true,
            appointments: true,
            users: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
