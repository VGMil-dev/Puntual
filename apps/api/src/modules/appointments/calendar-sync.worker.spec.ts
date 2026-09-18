import { Test, TestingModule } from '@nestjs/testing';
import { JobStatus } from '@prisma/client';
import {
  CalendarSyncWorker,
  calculateCalendarSyncBackoffDelaySeconds,
} from './calendar-sync.worker';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { CALENDAR_PORT } from '../calendar/ports/calendar.port';

describe('CalendarSyncWorker (RNF-006 / H3 / Decisión D9)', () => {
  let worker: CalendarSyncWorker;
  let prismaMock: any;
  let calendarPortMock: any;
  let loggerMock: any;

  const mockClinicId = '11111111-1111-4111-a111-111111111111';
  const mockDoctorId = '22222222-2222-4222-a222-222222222222';
  const mockApptId = '33333333-3333-4333-a333-333333333333';
  const mockJobId = 'job-sync-1';

  beforeEach(async () => {
    prismaMock = {
      scheduledJob: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      appointment: {
        update: jest.fn(),
      },
      $transaction: jest.fn(async (ops: any) => {
        if (typeof ops === 'function') {
          return (ops as any)(prismaMock);
        }
        return Promise.all(ops);
      }),
    };

    calendarPortMock = {
      createEvent: jest.fn(),
    };

    loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarSyncWorker,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CALENDAR_PORT, useValue: calendarPortMock },
        { provide: StructuredLoggerService, useValue: loggerMock },
      ],
    }).compile();

    worker = module.get<CalendarSyncWorker>(CalendarSyncWorker);
  });

  describe('calculateCalendarSyncBackoffDelaySeconds', () => {
    it('should return exponential backoff intervals matching Decision D9 / RNF-006', () => {
      expect(calculateCalendarSyncBackoffDelaySeconds(1)).toBe(60); // 1 min
      expect(calculateCalendarSyncBackoffDelaySeconds(2)).toBe(300); // 5 min
      expect(calculateCalendarSyncBackoffDelaySeconds(3)).toBe(1800); // 30 min
      expect(calculateCalendarSyncBackoffDelaySeconds(4)).toBe(7200); // 2 hours
      expect(calculateCalendarSyncBackoffDelaySeconds(5)).toBe(21600); // 6 hours
    });
  });

  describe('sweepPendingJobs', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');

    it('should successfully sync pending calendar jobs and update appointment and job to COMPLETED', async () => {
      const mockJob = {
        id: mockJobId,
        clinicId: mockClinicId,
        entityId: mockApptId,
        type: 'calendar_sync',
        status: JobStatus.PENDING,
        attempts: 1,
        nextRetryAt: new Date('2026-09-17T11:59:00.000Z'),
        payload: {
          doctorId: mockDoctorId,
          calendarId: 'doctor@gavanti.com',
          summary: 'Cita: Paciente - Limpieza',
          description: 'Cita médica confirmada',
          startAt: '2026-09-20T10:00:00.000Z',
          endAt: '2026-09-20T10:30:00.000Z',
        },
      };

      prismaMock.scheduledJob.findMany.mockResolvedValue([mockJob]);
      calendarPortMock.createEvent.mockResolvedValue('google-event-id-999');

      const result = await worker.sweepPendingJobs({ nowOverride: now });

      expect(result.scannedJobs).toBe(1);
      expect(result.succeededJobs).toBe(1);
      expect(result.failedJobs).toBe(0);
      expect(result.retriedJobs).toBe(0);

      expect(calendarPortMock.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'doctor@gavanti.com',
          summary: 'Cita: Paciente - Limpieza',
          startAt: new Date('2026-09-20T10:00:00.000Z'),
          endAt: new Date('2026-09-20T10:30:00.000Z'),
        }),
      );

      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: mockApptId },
        data: {
          googleCalendarEventId: 'google-event-id-999',
          updatedAt: now,
        },
      });

      expect(prismaMock.scheduledJob.update).toHaveBeenCalledWith({
        where: { id: mockJobId },
        data: {
          status: JobStatus.COMPLETED,
          updatedAt: now,
        },
      });

      expect(loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining('CalendarSyncSucceeded'),
        'CalendarSyncWorker',
        expect.objectContaining({
          appointmentId: mockApptId,
          calendarEventId: 'google-event-id-999',
        }),
      );
    });

    it('should reschedule job with exponential backoff on retryable error when attempts < 5', async () => {
      const mockJob = {
        id: mockJobId,
        clinicId: mockClinicId,
        entityId: mockApptId,
        type: 'calendar_sync',
        status: JobStatus.PENDING,
        attempts: 2,
        nextRetryAt: new Date('2026-09-17T11:50:00.000Z'),
        payload: {
          doctorId: mockDoctorId,
          calendarId: 'doctor@gavanti.com',
          summary: 'Cita Odontológica',
          startAt: '2026-09-20T10:00:00.000Z',
          endAt: '2026-09-20T10:30:00.000Z',
        },
      };

      prismaMock.scheduledJob.findMany.mockResolvedValue([mockJob]);
      calendarPortMock.createEvent.mockRejectedValue(new Error('Google 503 Service Unavailable'));

      const result = await worker.sweepPendingJobs({ nowOverride: now });

      expect(result.scannedJobs).toBe(1);
      expect(result.succeededJobs).toBe(0);
      expect(result.retriedJobs).toBe(1);
      expect(result.failedJobs).toBe(0);

      // New attempts = 2 + 1 = 3 -> delay = 1800s (30 min)
      const expectedNextRetry = new Date(now.getTime() + 1800 * 1000);

      expect(prismaMock.scheduledJob.update).toHaveBeenCalledWith({
        where: { id: mockJobId },
        data: {
          attempts: 3,
          nextRetryAt: expectedNextRetry,
          lastError: 'Google 503 Service Unavailable',
          updatedAt: now,
        },
      });

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('CalendarSyncRetryScheduled'),
        'CalendarSyncWorker',
        expect.objectContaining({
          attempts: 3,
          appointmentId: mockApptId,
        }),
      );
    });

    it('should transition to FAILED and log Super Admin alert when 5th attempt fails (RNF-006)', async () => {
      const mockJob = {
        id: mockJobId,
        clinicId: mockClinicId,
        entityId: mockApptId,
        type: 'calendar_sync',
        status: JobStatus.PENDING,
        attempts: 4, // 4 prior attempts; this failure will be the 5th
        nextRetryAt: new Date('2026-09-17T11:00:00.000Z'),
        payload: {
          doctorId: mockDoctorId,
          calendarId: 'doctor@gavanti.com',
          summary: 'Cita Odontológica',
          startAt: '2026-09-20T10:00:00.000Z',
          endAt: '2026-09-20T10:30:00.000Z',
        },
      };

      prismaMock.scheduledJob.findMany.mockResolvedValue([mockJob]);
      calendarPortMock.createEvent.mockRejectedValue(new Error('Google Calendar 401 Unauthorized'));

      const result = await worker.sweepPendingJobs({ nowOverride: now });

      expect(result.scannedJobs).toBe(1);
      expect(result.succeededJobs).toBe(0);
      expect(result.retriedJobs).toBe(0);
      expect(result.failedJobs).toBe(1);

      expect(prismaMock.scheduledJob.update).toHaveBeenCalledWith({
        where: { id: mockJobId },
        data: {
          attempts: 5,
          status: JobStatus.FAILED,
          lastError: 'Google Calendar 401 Unauthorized',
          updatedAt: now,
        },
      });

      // Assert Super Admin alert is emitted
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.stringContaining('CalendarSyncPermanentFailure'),
        expect.any(String),
        'CalendarSyncWorker',
        expect.objectContaining({
          clinicId: mockClinicId,
          appointmentId: mockApptId,
          attempts: 5,
          alertTarget: 'SuperAdmin',
        }),
      );
    });

    it('should fail job immediately if payload is corrupt or missing calendarId', async () => {
      const corruptJob = {
        id: 'corrupt-job-id',
        clinicId: mockClinicId,
        entityId: mockApptId,
        type: 'calendar_sync',
        status: JobStatus.PENDING,
        attempts: 1,
        nextRetryAt: null,
        payload: null, // missing payload
      };

      prismaMock.scheduledJob.findMany.mockResolvedValue([corruptJob]);

      const result = await worker.sweepPendingJobs({ nowOverride: now });

      expect(result.scannedJobs).toBe(1);
      expect(result.failedJobs).toBe(1);
      expect(prismaMock.scheduledJob.update).toHaveBeenCalledWith({
        where: { id: 'corrupt-job-id' },
        data: {
          status: JobStatus.FAILED,
          lastError: expect.stringContaining('missing required calendar fields'),
          updatedAt: now,
        },
      });
    });
  });
});
