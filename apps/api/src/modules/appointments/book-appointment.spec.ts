import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import {
  AppointmentsService,
  BookAppointmentResult,
} from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HoldService } from '../holds/hold.service';
import { AvailabilityService } from '../availability/availability.service';
import { CALENDAR_PORT } from '../calendar/ports/calendar.port';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { BookAppointmentDto } from './dto/book-appointment.dto';

describe('BookAppointment Use Case (E2.2b-bis / CU-001 paso 4 / RF-025 / RF-029 / RNF-001 / RNF-011)', () => {
  let service: AppointmentsService;
  let controller: AppointmentsController;
  let prismaMock: any;
  let holdServiceMock: any;
  let availabilityServiceMock: any;
  let loggerMock: any;

  // In-memory relational database state for tests
  let appointmentsDb: Map<string, any>;
  let clinicsDb: Map<string, any>;
  let doctorsDb: Map<string, any>;
  let patientsDb: Map<string, any>;

  const clinicAId = 'clinic-uuid-aaaa-1111';
  const clinicBId = 'clinic-uuid-bbbb-2222';
  const doctorAId = 'doctor-uuid-aaaa-1111';
  const doctorBId = 'doctor-uuid-bbbb-2222';
  const patientAId = 'patient-uuid-aaaa-1111';
  const patientBId = 'patient-uuid-bbbb-2222';
  const conversationAId = 'conv-whatsapp-12345';
  const conversationBId = 'conv-whatsapp-67890';
  const traceId = 'trace-test-12345';

  const baseNow = new Date('2026-09-18T13:00:00.000Z'); // 08:00 America/Guayaquil
  const validFutureSlotStart = '2026-09-18T14:00:00.000Z'; // 09:00 America/Guayaquil
  const validFutureSlotEnd = '2026-09-18T14:30:00.000Z';

  const mockClinicA = {
    id: clinicAId,
    name: 'Clínica Dental del Valle',
    slug: 'dental-valle',
    defaultSlotDurationMinutes: 30,
    maxConcurrentHolds: 3,
  };

  const mockDoctorA = {
    id: doctorAId,
    clinicId: clinicAId,
    name: 'Dr. Roberto Gómez',
    slotDurationMinutes: 30,
  };

  const mockPatientA = {
    id: patientAId,
    clinicId: clinicAId,
    name: 'Carlos Mendoza',
    phone: '+593991234567',
  };

  beforeEach(async () => {
    appointmentsDb = new Map<string, any>();
    clinicsDb = new Map<string, any>();
    doctorsDb = new Map<string, any>();
    patientsDb = new Map<string, any>();

    // Seed defaults for clinic A
    clinicsDb.set(clinicAId, mockClinicA);
    doctorsDb.set(doctorAId, mockDoctorA);
    patientsDb.set(patientAId, mockPatientA);

    // Mock HoldService
    holdServiceMock = {
      acquireHold: jest.fn().mockResolvedValue({
        success: true,
        reason: 'OK',
        slotKey: `hold:slot:${clinicAId}:${doctorAId}:${validFutureSlotStart}`,
        counterKey: `hold:count:${clinicAId}:${doctorAId}`,
        expiresAt: new Date(baseNow.getTime() + 900 * 1000),
        ttlSeconds: 900,
      }),
      releaseHold: jest.fn().mockResolvedValue({
        released: true,
        slotKey: `hold:slot:${clinicAId}:${doctorAId}:${validFutureSlotStart}`,
        counterKey: `hold:count:${clinicAId}:${doctorAId}`,
      }),
      getDoctorHoldCount: jest.fn().mockResolvedValue(0),
      getHold: jest.fn().mockResolvedValue(null),
    };

    // Mock AvailabilityService
    availabilityServiceMock = {
      resolveSlotDuration: jest.fn().mockResolvedValue(30),
      getAvailabilityForDate: jest.fn().mockResolvedValue({
        date: '2026-09-18',
        slots: [
          {
            startAt: validFutureSlotStart,
            endAt: validFutureSlotEnd,
            durationMinutes: 30,
          },
        ],
      }),
    };

    // Mock Logger
    loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    // Mock PrismaService simulating scoped queries
    prismaMock = {
      clinic: {
        findUnique: jest.fn(async ({ where }: any) => {
          return clinicsDb.get(where.id) || null;
        }),
      },
      doctor: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const doc of doctorsDb.values()) {
            let match = true;
            if (where.id && doc.id !== where.id) match = false;
            if (where.clinicId && doc.clinicId !== where.clinicId) match = false;
            if (match) return { ...doc };
          }
          return null;
        }),
      },
      patient: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const pat of patientsDb.values()) {
            let match = true;
            if (where.id && pat.id !== where.id) match = false;
            if (where.clinicId && pat.clinicId !== where.clinicId) match = false;
            if (match) return { ...pat };
          }
          return null;
        }),
      },
      appointment: {
        findFirst: jest.fn(async ({ where, include }: any) => {
          for (const appt of appointmentsDb.values()) {
            let match = true;
            if (where.id && appt.id !== where.id) match = false;
            if (where.clinicId && appt.clinicId !== where.clinicId) match = false;
            if (where.doctorId && appt.doctorId !== where.doctorId) match = false;
            if (where.conversationId && appt.conversationId !== where.conversationId) match = false;
            if (where.startAt && appt.startAt.getTime() !== new Date(where.startAt).getTime()) match = false;
            if (where.status) {
              if (where.status.in && !where.status.in.includes(appt.status)) match = false;
              else if (typeof where.status === 'string' && appt.status !== where.status) match = false;
            }

            if (match) {
              const res = { ...appt };
              if (include?.doctor) res.doctor = doctorsDb.get(appt.doctorId) || mockDoctorA;
              if (include?.patient) res.patient = patientsDb.get(appt.patientId) || mockPatientA;
              if (include?.clinic) res.clinic = clinicsDb.get(appt.clinicId) || mockClinicA;
              return res;
            }
          }
          return null;
        }),
        create: jest.fn(async ({ data, include }: any) => {
          const id = `appointment-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const created = {
            id,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          appointmentsDb.set(id, created);
          const res = { ...created };
          if (include?.doctor) res.doctor = doctorsDb.get(data.doctorId) || mockDoctorA;
          if (include?.patient) res.patient = patientsDb.get(data.patientId) || mockPatientA;
          if (include?.clinic) res.clinic = clinicsDb.get(data.clinicId) || mockClinicA;
          return res;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        AppointmentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: HoldService, useValue: holdServiceMock },
        { provide: AvailabilityService, useValue: availabilityServiceMock },
        { provide: CALENDAR_PORT, useValue: {} },
        { provide: StructuredLoggerService, useValue: loggerMock },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    controller = module.get<AppointmentsController>(AppointmentsController);
  });

  const validDto: BookAppointmentDto = {
    clinicId: clinicAId,
    doctorId: doctorAId,
    patientId: patientAId,
    conversationId: conversationAId,
    startAt: validFutureSlotStart,
    motivo: 'Limpieza dental',
    ttlSeconds: 600,
    traceId,
  };

  describe('1. Flujo Exitoso (Happy Path)', () => {
    it('debe adquirir hold en Redis y crear la cita con estado SOLICITADA en Postgres', async () => {
      const result = await service.bookAppointment(validDto, { nowOverride: baseNow });

      expect(result.isIdempotentReplay).toBe(false);
      expect(result.status).toBe(AppointmentStatus.SOLICITADA);
      expect(result.appointment).toBeDefined();
      expect(result.appointment.clinicId).toBe(clinicAId);
      expect(result.appointment.doctorId).toBe(doctorAId);
      expect(result.appointment.patientId).toBe(patientAId);
      expect(result.appointment.conversationId).toBe(conversationAId);
      expect(result.appointment.status).toBe(AppointmentStatus.SOLICITADA);
      expect(result.appointment.reason).toBe('Limpieza dental');
      expect(result.appointment.startAt.toISOString()).toBe(validFutureSlotStart);
      expect(result.appointment.endAt.toISOString()).toBe(validFutureSlotEnd);

      // Verify Redis acquireHold call
      expect(holdServiceMock.acquireHold).toHaveBeenCalledWith({
        clinicId: clinicAId,
        doctorId: doctorAId,
        startAt: new Date(validFutureSlotStart),
        conversationId: conversationAId,
        ttlSeconds: 600,
        traceId,
      });

      // Verify Postgres creation
      expect(prismaMock.appointment.create).toHaveBeenCalledTimes(1);
      expect(appointmentsDb.size).toBe(1);
    });

    it('debe responder HTTP 201 Created desde AppointmentsController en una nueva reserva', async () => {
      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
      };

      const result = await controller.bookAppointment(validDto, mockRes);

      expect(result.isIdempotentReplay).toBe(false);
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.CREATED);
    });
  });

  describe('2. Slot ya bloqueado en Redis (CU-001 Alt Flow C)', () => {
    it('debe lanzar ConflictException y NO tocar Postgres si el slot ya está bloqueado', async () => {
      holdServiceMock.acquireHold.mockResolvedValueOnce({
        success: false,
        reason: 'SLOT_ALREADY_LOCKED',
        slotKey: 'hold:slot:mock',
        counterKey: 'hold:count:mock',
        expiresAt: new Date(),
        ttlSeconds: 900,
      });

      await expect(
        service.bookAppointment(validDto, { nowOverride: baseNow }),
      ).rejects.toThrow(ConflictException);

      // Verify Postgres was never touched
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
      expect(appointmentsDb.size).toBe(0);
    });
  });

  describe('3. Límite máximo de holds alcanzado por el doctor (MAX_HOLDS_EXCEEDED)', () => {
    it('debe lanzar ConflictException si el doctor alcanzó maxConcurrentHolds y NO tocar Postgres', async () => {
      holdServiceMock.acquireHold.mockResolvedValueOnce({
        success: false,
        reason: 'MAX_HOLDS_EXCEEDED',
        slotKey: 'hold:slot:mock',
        counterKey: 'hold:count:mock',
        expiresAt: new Date(),
        ttlSeconds: 900,
      });

      await expect(
        service.bookAppointment(validDto, { nowOverride: baseNow }),
      ).rejects.toThrow(ConflictException);

      // Verify Postgres was never touched
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
      expect(appointmentsDb.size).toBe(0);
    });
  });

  describe('4. Compensación obligatoria ante fallo de Postgres', () => {
    it('debe ejecutar releaseHold en Redis inmediatamente si prisma.appointment.create falla', async () => {
      const dbError = new Error('Database disk full or constraint violation');
      prismaMock.appointment.create.mockRejectedValueOnce(dbError);

      await expect(
        service.bookAppointment(validDto, { nowOverride: baseNow }),
      ).rejects.toThrow(dbError);

      // Verify Redis acquireHold was performed
      expect(holdServiceMock.acquireHold).toHaveBeenCalledTimes(1);

      // Mandatory compensation: verify releaseHold was immediately executed
      expect(holdServiceMock.releaseHold).toHaveBeenCalledTimes(1);
      expect(holdServiceMock.releaseHold).toHaveBeenCalledWith({
        clinicId: clinicAId,
        doctorId: doctorAId,
        startAt: new Date(validFutureSlotStart),
        conversationId: conversationAId,
        traceId,
      });
    });
  });

  describe('5. Idempotencia Estricta (RNF-011)', () => {
    it('debe devolver la cita existente sin duplicar ni llamar a acquireHold si ya existe en SOLICITADA vigente', async () => {
      // Seed existing active hold in SOLICITADA for same conversation + doctor + startAt
      const existingAppt = {
        id: 'existing-solicitada-uuid',
        clinicId: clinicAId,
        doctorId: doctorAId,
        patientId: patientAId,
        conversationId: conversationAId,
        status: AppointmentStatus.SOLICITADA,
        startAt: new Date(validFutureSlotStart),
        endAt: new Date(validFutureSlotEnd),
        holdExpiresAt: new Date(baseNow.getTime() + 500 * 1000), // Active: expires in future
        reason: 'Limpieza previa',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      appointmentsDb.set(existingAppt.id, existingAppt);

      const result = await service.bookAppointment(validDto, { nowOverride: baseNow });

      expect(result.isIdempotentReplay).toBe(true);
      expect(result.status).toBe(AppointmentStatus.SOLICITADA);
      expect(result.appointment.id).toBe(existingAppt.id);

      // Strict guarantee: neither Redis nor Postgres are touched
      expect(holdServiceMock.acquireHold).not.toHaveBeenCalled();
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
      expect(appointmentsDb.size).toBe(1);
    });

    it('debe devolver la cita existente si ya está en estado CONFIRMADA', async () => {
      const existingAppt = {
        id: 'existing-confirmada-uuid',
        clinicId: clinicAId,
        doctorId: doctorAId,
        patientId: patientAId,
        conversationId: conversationAId,
        status: AppointmentStatus.CONFIRMADA,
        startAt: new Date(validFutureSlotStart),
        endAt: new Date(validFutureSlotEnd),
        holdExpiresAt: null,
        reason: 'Cita ya pagada/confirmada',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      appointmentsDb.set(existingAppt.id, existingAppt);

      const result = await service.bookAppointment(validDto, { nowOverride: baseNow });

      expect(result.isIdempotentReplay).toBe(true);
      expect(result.status).toBe(AppointmentStatus.CONFIRMADA);
      expect(result.appointment.id).toBe(existingAppt.id);

      expect(holdServiceMock.acquireHold).not.toHaveBeenCalled();
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });

    it('debe responder HTTP 200 OK desde AppointmentsController ante replay idempotente', async () => {
      const existingAppt = {
        id: 'existing-solicitada-uuid',
        clinicId: clinicAId,
        doctorId: doctorAId,
        patientId: patientAId,
        conversationId: conversationAId,
        status: AppointmentStatus.SOLICITADA,
        startAt: new Date(validFutureSlotStart),
        endAt: new Date(validFutureSlotEnd),
        holdExpiresAt: new Date(baseNow.getTime() + 500 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      appointmentsDb.set(existingAppt.id, existingAppt);

      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
      };

      const result = await controller.bookAppointment(validDto, mockRes);

      expect(result.isIdempotentReplay).toBe(true);
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.OK);
    });

    it('debe proceder a reservar si la cita anterior estaba en SOLICITADA pero su hold ya expiró', async () => {
      const expiredAppt = {
        id: 'expired-solicitada-uuid',
        clinicId: clinicAId,
        doctorId: doctorAId,
        patientId: patientAId,
        conversationId: conversationAId,
        status: AppointmentStatus.SOLICITADA,
        startAt: new Date(validFutureSlotStart),
        endAt: new Date(validFutureSlotEnd),
        holdExpiresAt: new Date(baseNow.getTime() - 60 * 1000), // Expired 1 min ago
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      appointmentsDb.set(expiredAppt.id, expiredAppt);

      const result = await service.bookAppointment(validDto, { nowOverride: baseNow });

      // Expired appointment should not replay as idempotent
      expect(result.isIdempotentReplay).toBe(false);
      expect(holdServiceMock.acquireHold).toHaveBeenCalledTimes(1);
      expect(prismaMock.appointment.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. Aislamiento Multi-Tenant (RNF-001)', () => {
    it('debe rechazar la reserva con NotFoundException si el doctor pertenece a otra clínica', async () => {
      // Seed Doctor B belonging to Clinic B
      doctorsDb.set(doctorBId, {
        id: doctorBId,
        clinicId: clinicBId,
        name: 'Dra. María Elena',
      });

      const foreignDoctorDto = {
        ...validDto,
        doctorId: doctorBId, // Doctor is in clinic B, but DTO requests clinic A
      };

      await expect(
        service.bookAppointment(foreignDoctorDto, { nowOverride: baseNow }),
      ).rejects.toThrow(NotFoundException);

      expect(holdServiceMock.acquireHold).not.toHaveBeenCalled();
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });

    it('debe rechazar la reserva con NotFoundException si el paciente pertenece a otra clínica', async () => {
      // Seed Patient B belonging to Clinic B
      patientsDb.set(patientBId, {
        id: patientBId,
        clinicId: clinicBId,
        name: 'Pedro Ramírez',
      });

      const foreignPatientDto = {
        ...validDto,
        patientId: patientBId, // Patient is in clinic B, but DTO requests clinic A
      };

      await expect(
        service.bookAppointment(foreignPatientDto, { nowOverride: baseNow }),
      ).rejects.toThrow(NotFoundException);

      expect(holdServiceMock.acquireHold).not.toHaveBeenCalled();
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });

    it('debe rechazar la reserva si la clínica no existe', async () => {
      const nonExistentClinicDto = {
        ...validDto,
        clinicId: 'non-existent-clinic',
      };

      await expect(
        service.bookAppointment(nonExistentClinicDto, { nowOverride: baseNow }),
      ).rejects.toThrow(NotFoundException);

      expect(holdServiceMock.acquireHold).not.toHaveBeenCalled();
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });
  });

  describe('7. Validación de Disponibilidad y Horario en el Pasado', () => {
    it('debe rechazar con BadRequestException si el horario solicitado está en el pasado', async () => {
      const pastDto = {
        ...validDto,
        startAt: new Date(baseNow.getTime() - 1000).toISOString(),
      };

      await expect(
        service.bookAppointment(pastDto, { nowOverride: baseNow }),
      ).rejects.toThrow(BadRequestException);

      expect(holdServiceMock.acquireHold).not.toHaveBeenCalled();
    });

    it('debe rechazar con ConflictException si AvailabilityService reporta que el slot no está disponible', async () => {
      availabilityServiceMock.getAvailabilityForDate.mockResolvedValueOnce({
        date: '2026-09-18',
        slots: [], // No available slots
      });

      await expect(
        service.bookAppointment(validDto, { nowOverride: baseNow }),
      ).rejects.toThrow(ConflictException);

      expect(holdServiceMock.acquireHold).not.toHaveBeenCalled();
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });
  });
});
