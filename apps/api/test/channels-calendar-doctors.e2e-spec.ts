import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { ChannelGatewayService } from '../src/modules/channels/channel-gateway.service';
import { ChannelsService } from '../src/modules/channels/channels.service';
import { CALENDAR_PORT, CalendarPort } from '../src/modules/calendar/ports/calendar.port';
import { ChannelType, UserRole, SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

describe('Channels, Calendar, Doctors & AI E2E (E1.3, E1.4, E1.5, E11.4, E2.1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let clinicId: string;
  let clinicAdminToken: string;
  let doctorId: string;
  let specialtyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Create a dedicated clinic fixture
    await prisma.clinic.deleteMany({
      where: { slug: 'clinic-features-e2e' },
    });

    const clinic = await prisma.clinic.create({
      data: {
        name: 'Clínica Features E2E',
        slug: 'clinic-features-e2e',
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        defaultSlotDurationMinutes: 30,
      },
    });
    clinicId = clinic.id;

    const passwordHash = await bcrypt.hash('FeaturesPass123!', 12);
    await prisma.user.create({
      data: {
        clinicId,
        email: 'admin.features@test.com',
        name: 'Admin Features',
        passwordHash,
        role: UserRole.CLINIC_ADMIN,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'admin.features@test.com',
        password: 'FeaturesPass123!',
      })
      .expect(200);

    clinicAdminToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.clinic.deleteMany({
      where: { slug: 'clinic-features-e2e' },
    });
    await app.close();
  });

  describe('E1.5: Doctores, Especialidades y Horarios', () => {
    it('Creates a Specialty (POST /specialties)', async () => {
      const res = await request(app.getHttpServer())
        .post('/specialties')
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          name: 'Ortodoncia',
          defaultSlotDurationMinutes: 45,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Ortodoncia');
      expect(res.body.defaultSlotDurationMinutes).toBe(45);
      expect(res.body.clinicId).toBe(clinicId);

      specialtyId = res.body.id;
    });

    it('Creates a Doctor linked to Specialty (POST /doctors)', async () => {
      const res = await request(app.getHttpServer())
        .post('/doctors')
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          name: 'Dr. Roberto Ortiz',
          email: 'dr.ortiz@test.com',
          specialtyIds: [specialtyId],
          slotDurationMinutes: 60,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Dr. Roberto Ortiz');
      expect(res.body.slotDurationMinutes).toBe(60);
      expect(res.body.doctorSpecialties.length).toBe(1);

      doctorId = res.body.id;
    });

    it('Adds a weekly schedule in America/Guayaquil (POST /doctors/:id/schedules)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/doctors/${doctorId}/schedules`)
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          dayOfWeek: 1, // Monday
          startTime: '09:00',
          endTime: '17:00',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.dayOfWeek).toBe(1);
      expect(res.body.startTime).toBe('09:00');
      expect(res.body.endTime).toBe('17:00');
    });

    it('Rejects invalid schedule times where start >= end (400 Bad Request)', async () => {
      await request(app.getHttpServer())
        .post(`/doctors/${doctorId}/schedules`)
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          dayOfWeek: 2,
          startTime: '18:00',
          endTime: '12:00',
        })
        .expect(400);
    });
  });

  describe('E1.3: Credenciales de Canal (Channel Gateway)', () => {
    const testPhoneId = `55${Date.now().toString().slice(-9)}`;

    it('Saves WhatsApp credentials and stores them encrypted in rest (POST /channels/credentials)', async () => {
      const plainToken = 'EAAX_meta_super_secret_token_12345';

      const res = await request(app.getHttpServer())
        .post('/channels/credentials')
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          channelType: ChannelType.WHATSAPP,
          identifier: testPhoneId,
          token: plainToken,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.identifier).toBe(testPhoneId);
      expect(res.body.channelType).toBe(ChannelType.WHATSAPP);

      // Verify in DB that plain token is NOT stored in plaintext
      const record = await prisma.channelCredential.findUnique({
        where: { id: res.body.id },
      });
      expect(record?.encryptedToken).not.toBe(plainToken);
      expect(record?.encryptedToken).toContain(':'); // IV:tag:cipher format
    });

    it('Channel Gateway resolves WhatsApp phone number id to clinicId', async () => {
      const gateway = app.get(ChannelGatewayService);
      const resolved = await gateway.resolveClinicByPhoneNumberId(testPhoneId);
      expect(resolved).toBe(clinicId);
    });
  });

  describe('E1.4: Google Calendar Doctor OAuth', () => {
    it('Generates Google OAuth URL for Doctor (GET /calendar/oauth/url)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/calendar/oauth/url?doctorId=${doctorId}`)
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .expect(200);

      expect(res.body.url).toBeDefined();
      expect(res.body.url).toContain('accounts.google.com');
      expect(res.body.url).toContain('access_type=offline');
    });

    it('Doctor onboarding succeeds and remains fully functional even when Calendar connection is unconfigured or fails (resilience)', async () => {
      // Create another doctor without Google Calendar connection
      const docRes = await request(app.getHttpServer())
        .post('/doctors')
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          name: 'Dra. Elena Silva',
          email: 'dra.silva@puntual.test',
          specialtyIds: [specialtyId],
          slotDurationMinutes: 45,
        })
        .expect(201);

      expect(docRes.body.id).toBeDefined();
      expect(docRes.body.googleCalendarWriteVerifiedAt).toBeNull();

      // Verify schedules can still be created and doctor operates normally without Calendar blocker
      const schedRes = await request(app.getHttpServer())
        .post(`/doctors/${docRes.body.id}/schedules`)
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          dayOfWeek: 2, // Tuesday
          startTime: '08:00',
          endTime: '12:00',
        })
        .expect(201);

      expect(schedRes.body.id).toBeDefined();
      expect(schedRes.body.doctorId).toBe(docRes.body.id);
    });

    it('Validates token refresh on CalendarPort and propagates explicit error on failure (E1.4 / fail-fast)', async () => {
      const calendarPort = app.get<CalendarPort>(CALENDAR_PORT);
      const channelsService = app.get(ChannelsService);

      const fakeRefreshToken = 'mock_google_refresh_token_xyz_12345';
      const cipher = channelsService.encryptToken(fakeRefreshToken);

      // Test successful refresh via mocked OAuth client
      const oauthMock = {
        setCredentials: jest.fn(),
        refreshAccessToken: jest.fn().mockResolvedValue({
          credentials: { access_token: 'mock_refreshed_access_token_success' },
        }),
      };
      const spy = jest.spyOn(calendarPort as any, 'getOAuthClient').mockReturnValue(oauthMock as any);

      const refreshedToken = await calendarPort.refreshAccessToken!(cipher);
      expect(refreshedToken).toBe('mock_refreshed_access_token_success');
      spy.mockRestore();

      // Test explicit failure propagation (fail-fast: no fake simulated success)
      const failMock = {
        setCredentials: jest.fn(),
        refreshAccessToken: jest.fn().mockRejectedValue(new Error('Invalid Google OAuth refresh grant')),
      };
      const failSpy = jest.spyOn(calendarPort as any, 'getOAuthClient').mockReturnValue(failMock as any);

      await expect(calendarPort.refreshAccessToken!(cipher)).rejects.toThrow('Invalid Google OAuth refresh grant');
      failSpy.mockRestore();
    });
  });

  describe('E11.4: Observabilidad Mínima (GET /metrics/operational)', () => {
    it('Rejects unauthenticated request with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .get(`/metrics/operational?clinicId=${clinicId}`)
        .expect(401);
    });

    it('Rejects cross-tenant metric access by Clinic Admin with 403 Forbidden', async () => {
      const otherClinicId = '99999999-9999-9999-9999-999999999999';
      await request(app.getHttpServer())
        .get(`/metrics/operational?clinicId=${otherClinicId}`)
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .expect(403);
    });

    it('Returns aggregated operational metrics for authorized Clinic Admin (p50/p95 latency and counts)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/metrics/operational?clinicId=${clinicId}`)
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .expect(200);

      expect(res.body.totalLogs).toBeDefined();
      expect(res.body.latency).toBeDefined();
      expect(res.body.latency.p50Ms).toBeDefined();
      expect(res.body.latency.p95Ms).toBeDefined();
      expect(res.body.byCategory).toBeInstanceOf(Array);
    });
  });

  describe('E2.1: Intent, Closed Motivo & Specialty Recommendation', () => {
    it('Rejects unauthenticated request with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .post('/ai/classify-message')
        .send({
          clinicId,
          message: 'Hola, quisiera agendar una cita.',
        })
        .expect(401);
    });

    it('Rejects cross-tenant access with 403 Forbidden', async () => {
      const otherClinicId = '00000000-0000-4000-8000-000000000000';
      await request(app.getHttpServer())
        .post('/ai/classify-message')
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          clinicId: otherClinicId,
          message: 'Hola, quisiera agendar una cita.',
        })
        .expect(403);
    });

    it('Classifies appointment request, extracts closed reason ORTODONCIA, and recommends Dr. Ortiz', async () => {
      const res = await request(app.getHttpServer())
        .post('/ai/classify-message')
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          clinicId,
          message: 'Hola, buenas tardes, quisiera agendar una cita para colocarme brackets u ortodoncia por favor.',
        })
        .expect(201);

      expect(res.body.intent).toBe('AGENDAR_CITA');
      expect(res.body.reason).toBe('ORTODONCIA');
      expect(res.body.confidence).toBeGreaterThan(0);
      expect(res.body.suggestedDoctors).toBeInstanceOf(Array);
      expect(res.body.suggestedDoctors.some((d: any) => d.id === doctorId)).toBe(true);
      expect(res.body.execution).toBeDefined();
    });

    it('Ambiguous message flags clarificationNeeded with orienting question', async () => {
      const res = await request(app.getHttpServer())
        .post('/ai/classify-message')
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({
          clinicId,
          message: 'Hola, tengo una duda.',
        })
        .expect(201);

      expect(res.body.clarificationNeeded).toBe(true);
      expect(res.body.clarificationQuestion).toBeDefined();
    });
  });
});
