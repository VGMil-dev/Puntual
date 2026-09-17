import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { AvailabilityService } from './availability.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';

describe('AvailabilityService (E2.2a)', () => {
  let service: AvailabilityService;
  let prisma: any;
  let redis: any;

  const mockClinicId = '11111111-1111-1111-1111-111111111111';
  const mockDoctorId = '22222222-2222-2222-2222-222222222222';
  const mockSpecialtyId = '33333333-3333-3333-3333-333333333333';

  // Base simulation time: 2026-09-18 08:00:00 America/Guayaquil (13:00:00 UTC)
  // 2026-09-18 is a Friday (dayOfWeek: 5)
  const baseNow = new Date('2026-09-18T13:00:00.000Z');

  beforeEach(async () => {
    prisma = {
      doctor: {
        findFirst: jest.fn(),
      },
      specialty: {
        findFirst: jest.fn(),
      },
      clinic: {
        findUnique: jest.fn(),
      },
      doctorSchedule: {
        findMany: jest.fn(),
      },
      appointment: {
        findMany: jest.fn(),
      },
    };

    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        {
          provide: StructuredLoggerService,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AvailabilityService>(AvailabilityService);
  });

  describe('1. Cálculo de slots según horario de atención (DoctorSchedule)', () => {
    it('debe generar slots correctamente según los bloques de atención en America/Guayaquil (UTC-5)', async () => {
      // Setup doctor
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: null,
      });

      // Clinic default: 30 min
      prisma.clinic.findUnique.mockResolvedValue({
        id: mockClinicId,
        defaultSlotDurationMinutes: 30,
      });

      // Friday schedule: 09:00 to 11:00 (4 slots of 30 min)
      prisma.doctorSchedule.findMany.mockImplementation((args: any) => {
        if (args.where.dayOfWeek === 5) {
          return Promise.resolve([
            {
              id: 'sched-1',
              clinicId: mockClinicId,
              doctorId: mockDoctorId,
              dayOfWeek: 5,
              startTime: '09:00',
              endTime: '11:00',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-18',
          endDate: '2026-09-18',
        },
        baseNow,
      );

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-09-18');
      expect(result[0].slots).toHaveLength(4);

      // In America/Guayaquil (UTC-5):
      // 09:00 local = 14:00 UTC
      // 09:30 local = 14:30 UTC
      // 10:00 local = 15:00 UTC
      // 10:30 local = 15:30 UTC
      expect(result[0].slots[0]).toEqual({
        startAt: '2026-09-18T14:00:00.000Z',
        endAt: '2026-09-18T14:30:00.000Z',
        durationMinutes: 30,
      });
      expect(result[0].slots[1]).toEqual({
        startAt: '2026-09-18T14:30:00.000Z',
        endAt: '2026-09-18T15:00:00.000Z',
        durationMinutes: 30,
      });
      expect(result[0].slots[2]).toEqual({
        startAt: '2026-09-18T15:00:00.000Z',
        endAt: '2026-09-18T15:30:00.000Z',
        durationMinutes: 30,
      });
      expect(result[0].slots[3]).toEqual({
        startAt: '2026-09-18T15:30:00.000Z',
        endAt: '2026-09-18T16:00:00.000Z',
        durationMinutes: 30,
      });
    });

    it('debe retornar lista vacía de slots si el doctor no atiende en ese día de la semana', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 30,
      });

      // No schedules for Saturday (dayOfWeek: 6)
      prisma.doctorSchedule.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-19', // Saturday
          endDate: '2026-09-19',
        },
        baseNow,
      );

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-09-19');
      expect(result[0].slots).toEqual([]);
    });

    it('debe soportar múltiples bloques de atención en el mismo día (mañana y tarde)', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 30,
      });

      // Friday schedule: 09:00-10:00 (2 slots) and 14:00-15:00 (2 slots)
      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-am',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          dayOfWeek: 5,
          startTime: '09:00',
          endTime: '10:00',
        },
        {
          id: 'sched-pm',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          dayOfWeek: 5,
          startTime: '14:00',
          endTime: '15:00',
        },
      ]);
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-18',
          endDate: '2026-09-18',
        },
        baseNow,
      );

      expect(result[0].slots).toHaveLength(4);
      // Morning slots: 09:00-09:30, 09:30-10:00 (14:00-14:30 UTC, 14:30-15:00 UTC)
      expect(result[0].slots[0].startAt).toBe('2026-09-18T14:00:00.000Z');
      expect(result[0].slots[1].startAt).toBe('2026-09-18T14:30:00.000Z');
      // Afternoon slots: 14:00-14:30, 14:30-15:00 (19:00-19:30 UTC, 19:30-20:00 UTC)
      expect(result[0].slots[2].startAt).toBe('2026-09-18T19:00:00.000Z');
      expect(result[0].slots[3].startAt).toBe('2026-09-18T19:30:00.000Z');
    });
  });

  describe('2. Jerarquía de duración de slot (Doctor > Specialty > Clinic default)', () => {
    it('prioridad 1: Doctor sobrescribe Specialty y Clinic', async () => {
      // Doctor has 45 min
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 45,
      });

      const duration = await service.resolveSlotDuration({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        specialtyId: mockSpecialtyId,
      });

      expect(duration).toBe(45);
    });

    it('prioridad 2: Specialty sobrescribe Clinic cuando Doctor no tiene override', async () => {
      // Doctor has null
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: null,
      });

      // Specialty has 60 min
      prisma.specialty.findFirst.mockResolvedValue({
        id: mockSpecialtyId,
        clinicId: mockClinicId,
        defaultSlotDurationMinutes: 60,
      });

      const duration = await service.resolveSlotDuration({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        specialtyId: mockSpecialtyId,
      });

      expect(duration).toBe(60);
    });

    it('prioridad 2b: Permite resolver Specialty buscando por motivo (nombre insensible)', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: null,
      });

      prisma.specialty.findFirst.mockResolvedValue({
        id: 'spec-ortodoncia',
        clinicId: mockClinicId,
        name: 'Ortodoncia',
        defaultSlotDurationMinutes: 50,
      });

      const duration = await service.resolveSlotDuration({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
        motivo: 'ortodoncia',
      });

      expect(duration).toBe(50);
    });

    it('prioridad 3: Clinic default se usa cuando Doctor y Specialty no definen duración', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: null,
      });

      prisma.clinic.findUnique.mockResolvedValue({
        id: mockClinicId,
        defaultSlotDurationMinutes: 20,
      });

      const duration = await service.resolveSlotDuration({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
      });

      expect(duration).toBe(20);
    });

    it('fallback final: 30 minutos cuando ningún nivel define duración', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: null,
      });

      prisma.clinic.findUnique.mockResolvedValue(null);

      const duration = await service.resolveSlotDuration({
        clinicId: mockClinicId,
        doctorId: mockDoctorId,
      });

      expect(duration).toBe(30);
    });
  });

  describe('3. Exclusión de citas confirmadas y holds vigentes', () => {
    it('debe excluir slots que se solapen con citas CONFIRMADA', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 30,
      });

      // Schedule: 09:00 to 11:00 (slots at 09:00, 09:30, 10:00, 10:30 local)
      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          dayOfWeek: 5,
          startTime: '09:00',
          endTime: '11:00',
        },
      ]);

      // Confirmed appointment from 09:30 to 10:00 local (14:30 to 15:00 UTC)
      prisma.appointment.findMany.mockResolvedValue([
        {
          id: 'appt-confirmed',
          status: AppointmentStatus.CONFIRMADA,
          startAt: new Date('2026-09-18T14:30:00.000Z'),
          endAt: new Date('2026-09-18T15:00:00.000Z'),
          holdExpiresAt: null,
          reason: 'Consulta general',
        },
      ]);

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-18',
          endDate: '2026-09-18',
        },
        baseNow,
      );

      const slotStarts = result[0].slots.map((s) => s.startAt);
      expect(slotStarts).not.toContain('2026-09-18T14:30:00.000Z');
      expect(slotStarts).toEqual([
        '2026-09-18T14:00:00.000Z',
        '2026-09-18T15:00:00.000Z',
        '2026-09-18T15:30:00.000Z',
      ]);
    });

    it('debe excluir slots que tengan un hold activo (SOLICITADA con holdExpiresAt > NOW()) de otra conversación', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 30,
      });

      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          dayOfWeek: 5,
          startTime: '09:00',
          endTime: '11:00',
        },
      ]);

      // Active hold on 10:00-10:30 (15:00-15:30 UTC), expires 15 minutes after baseNow
      prisma.appointment.findMany.mockResolvedValue([
        {
          id: 'appt-held-other',
          status: AppointmentStatus.SOLICITADA,
          startAt: new Date('2026-09-18T15:00:00.000Z'),
          endAt: new Date('2026-09-18T15:30:00.000Z'),
          holdExpiresAt: new Date('2026-09-18T13:15:00.000Z'), // baseNow + 15 min
          reason: 'conv-other-patient',
        },
      ]);

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-18',
          endDate: '2026-09-18',
          conversationId: 'my-conversation-123',
        },
        baseNow,
      );

      const slotStarts = result[0].slots.map((s) => s.startAt);
      expect(slotStarts).not.toContain('2026-09-18T15:00:00.000Z');
      expect(slotStarts).toEqual([
        '2026-09-18T14:00:00.000Z',
        '2026-09-18T14:30:00.000Z',
        '2026-09-18T15:30:00.000Z',
      ]);
    });

    it('debe excluir slots que tengan lock activo en Redis por otra conversación', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 30,
      });

      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          dayOfWeek: 5,
          startTime: '09:00',
          endTime: '10:00',
        },
      ]);
      prisma.appointment.findMany.mockResolvedValue([]);

      // Redis lock holds 09:00 slot (14:00 UTC) for another conversation
      redis.get.mockImplementation((key: string) => {
        if (key.includes('2026-09-18T14:00:00.000Z')) {
          return Promise.resolve('other-conversation-456');
        }
        return Promise.resolve(null);
      });

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-18',
          endDate: '2026-09-18',
          conversationId: 'my-conversation-123',
        },
        baseNow,
      );

      expect(result[0].slots).toHaveLength(1);
      expect(result[0].slots[0].startAt).toBe('2026-09-18T14:30:00.000Z');
    });
  });

  describe('4. Inclusión de slots cuando el hold expiró o pertenece a la misma conversación', () => {
    it('debe incluir el slot si el hold expiró (holdExpiresAt <= NOW())', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 30,
      });

      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          dayOfWeek: 5,
          startTime: '09:00',
          endTime: '10:00',
        },
      ]);

      // SOLICITADA appointment with expired hold (expired 5 min ago)
      prisma.appointment.findMany.mockResolvedValue([
        {
          id: 'appt-expired-hold',
          status: AppointmentStatus.SOLICITADA,
          startAt: new Date('2026-09-18T14:00:00.000Z'),
          endAt: new Date('2026-09-18T14:30:00.000Z'),
          holdExpiresAt: new Date('2026-09-18T12:55:00.000Z'), // expired 5 min before baseNow
          reason: 'old-expired-conversation',
        },
      ]);

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-18',
          endDate: '2026-09-18',
        },
        baseNow,
      );

      // 09:00 slot is released and available!
      expect(result[0].slots).toHaveLength(2);
      expect(result[0].slots[0].startAt).toBe('2026-09-18T14:00:00.000Z');
      expect(result[0].slots[1].startAt).toBe('2026-09-18T14:30:00.000Z');
    });

    it('debe mantener disponible el slot si el hold activo pertenece a la misma conversación solicitante', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 30,
      });

      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          dayOfWeek: 5,
          startTime: '09:00',
          endTime: '10:00',
        },
      ]);

      const sameConversationId = 'conv-current-user-777';

      // Active hold on 09:00 belonging to same conversation
      prisma.appointment.findMany.mockResolvedValue([
        {
          id: 'appt-same-conv',
          status: AppointmentStatus.SOLICITADA,
          startAt: new Date('2026-09-18T14:00:00.000Z'),
          endAt: new Date('2026-09-18T14:30:00.000Z'),
          holdExpiresAt: new Date('2026-09-18T13:15:00.000Z'),
          reason: sameConversationId,
        },
      ]);

      // Redis also holds for same conversation
      redis.get.mockImplementation((key: string) => {
        if (key.includes('2026-09-18T14:00:00.000Z')) {
          return Promise.resolve(sameConversationId);
        }
        return Promise.resolve(null);
      });

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-18',
          endDate: '2026-09-18',
          conversationId: sameConversationId,
        },
        baseNow,
      );

      // The slot is NOT blocked for this conversation
      expect(result[0].slots).toHaveLength(2);
      expect(result[0].slots[0].startAt).toBe('2026-09-18T14:00:00.000Z');
      expect(result[0].slots[1].startAt).toBe('2026-09-18T14:30:00.000Z');
    });
  });

  describe('5. Filtrado de slots en el pasado relativo a NOW()', () => {
    it('debe descartar slots cuya hora de inicio sea anterior o igual a NOW()', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 30,
      });

      // Schedule: 09:00 to 12:00 (6 slots: 09:00, 09:30, 10:00, 10:30, 11:00, 11:30)
      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          dayOfWeek: 5,
          startTime: '09:00',
          endTime: '12:00',
        },
      ]);
      prisma.appointment.findMany.mockResolvedValue([]);

      // Simulation time: 10:15 local time (15:15 UTC) on 2026-09-18
      const midDayNow = new Date('2026-09-18T15:15:00.000Z');

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-18',
          endDate: '2026-09-18',
        },
        midDayNow,
      );

      // Slots at 09:00 (14:00 UTC), 09:30 (14:30 UTC), and 10:00 (15:00 UTC) are in the past
      // Remaining slots must be: 10:30 (15:30 UTC), 11:00 (16:00 UTC), 11:30 (16:30 UTC)
      expect(result[0].slots).toHaveLength(3);
      expect(result[0].slots[0].startAt).toBe('2026-09-18T15:30:00.000Z');
      expect(result[0].slots[1].startAt).toBe('2026-09-18T16:00:00.000Z');
      expect(result[0].slots[2].startAt).toBe('2026-09-18T16:30:00.000Z');
    });
  });

  describe('6. Validaciones y Multi-Tenant Boundary (RNF-001)', () => {
    it('debe lanzar NotFoundException si el doctor no pertenece a la clínica', async () => {
      prisma.doctor.findFirst.mockResolvedValue(null);

      await expect(
        service.getAvailability({
          clinicId: mockClinicId,
          doctorId: 'unknown-doctor',
          startDate: '2026-09-18',
          endDate: '2026-09-18',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar BadRequestException si startDate es posterior a endDate', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
      });

      await expect(
        service.getAvailability({
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-20',
          endDate: '2026-09-18',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe procesar rangos multi-día correctamente (ej. Viernes a Domingo)', async () => {
      prisma.doctor.findFirst.mockResolvedValue({
        id: mockDoctorId,
        clinicId: mockClinicId,
        slotDurationMinutes: 30,
      });

      // Friday (5) has 2 slots; Saturday (6) and Sunday (0) have none
      prisma.doctorSchedule.findMany.mockImplementation((args: any) => {
        if (args.where.dayOfWeek === 5) {
          return Promise.resolve([
            {
              id: 'sched-fri',
              clinicId: mockClinicId,
              doctorId: mockDoctorId,
              dayOfWeek: 5,
              startTime: '09:00',
              endTime: '10:00',
            },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getAvailability(
        {
          clinicId: mockClinicId,
          doctorId: mockDoctorId,
          startDate: '2026-09-18',
          endDate: '2026-09-20',
        },
        baseNow,
      );

      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2026-09-18');
      expect(result[0].slots).toHaveLength(2);

      expect(result[1].date).toBe('2026-09-19');
      expect(result[1].slots).toHaveLength(0);

      expect(result[2].date).toBe('2026-09-20');
      expect(result[2].slots).toHaveLength(0);
    });
  });
});
