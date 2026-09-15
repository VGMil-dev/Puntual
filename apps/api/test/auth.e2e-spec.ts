import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { SmtpEmailAdapter } from '../src/integrations/email/adapters/smtp-email.adapter';
import { UserRole, PlanType, SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

describe('Auth & Clinic Onboarding E2E (E1.1 / E1.2 / DoD §10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let emailAdapter: SmtpEmailAdapter;

  let superAdminToken: string;
  let clinicAlfaAdminToken: string;
  let clinicBetaAdminToken: string;

  let clinicAlfaId: string;
  let clinicBetaId: string;

  let clinicAlfaAdminEmail = 'admin.alfa.e2e@puntual.test';
  let clinicBetaAdminEmail = 'admin.beta.e2e@puntual.test';
  let adminPassword = 'Password123!';

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
    emailAdapter = app.get(SmtpEmailAdapter);
    emailAdapter.clearSentEmails();

    // Cleanup existing fixtures
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: [clinicAlfaAdminEmail, clinicBetaAdminEmail, 'superadmin.e2e@puntual.test'] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [clinicAlfaAdminEmail, clinicBetaAdminEmail, 'superadmin.e2e@puntual.test'] } },
    });
    await prisma.clinic.deleteMany({
      where: { slug: { in: ['clinic-alfa-e2e', 'clinic-beta-e2e'] } },
    });

    // Create Super Admin fixture
    const superAdminPasswordHash = await bcrypt.hash('SuperAdminPass123!', 12);
    const superAdmin = await prisma.user.create({
      data: {
        email: 'superadmin.e2e@puntual.test',
        passwordHash: superAdminPasswordHash,
        name: 'Milton Super Admin',
        role: UserRole.SUPER_ADMIN,
      },
    });

    // Login as Super Admin
    const superLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'superadmin.e2e@puntual.test',
        password: 'SuperAdminPass123!',
      })
      .expect(200);

    superAdminToken = superLoginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: [clinicAlfaAdminEmail, clinicBetaAdminEmail, 'superadmin.e2e@puntual.test'] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [clinicAlfaAdminEmail, clinicBetaAdminEmail, 'superadmin.e2e@puntual.test'] } },
    });
    await prisma.clinic.deleteMany({
      where: { slug: { in: ['clinic-alfa-e2e', 'clinic-beta-e2e'] } },
    });
    await app.close();
  });

  describe('E1.1: Alta de Clínica (POST /clinics)', () => {
    it('Requires SUPER_ADMIN role (unauthenticated -> 401)', async () => {
      await request(app.getHttpServer())
        .post('/clinics')
        .send({
          name: 'Clínica Sin Auth',
          slug: 'clinic-no-auth',
          adminName: 'Admin',
          adminEmail: 'admin@noauth.com',
        })
        .expect(401);
    });

    it('Super Admin creates Clinic Alfa with plan TRIAL without payment gateway (RF-020)', async () => {
      const res = await request(app.getHttpServer())
        .post('/clinics')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Clínica Alfa E2E',
          slug: 'clinic-alfa-e2e',
          planType: PlanType.TRIAL,
          trialDays: 14,
          adminName: 'Admin Alfa',
          adminEmail: clinicAlfaAdminEmail,
          adminPassword: adminPassword,
        })
        .expect(201);

      expect(res.body.clinic).toBeDefined();
      expect(res.body.clinic.slug).toBe('clinic-alfa-e2e');
      expect(res.body.clinic.subscriptionStatus).toBe(SubscriptionStatus.TRIAL);
      expect(res.body.subscription.planType).toBe(PlanType.TRIAL);
      expect(res.body.subscription.trialEndsAt).not.toBeNull();
      expect(res.body.admin.email).toBe(clinicAlfaAdminEmail);

      clinicAlfaId = res.body.clinic.id;

      // Verify invitation email was dispatched (RF-026)
      const sent = emailAdapter.getSentEmails();
      const invite = sent.find((e) => e.to === clinicAlfaAdminEmail);
      expect(invite).toBeDefined();
      expect(invite?.subject).toContain('Invitación');
      expect(invite?.html).toContain('login');
    });

    it('Super Admin creates Clinic Beta with plan PRO', async () => {
      const res = await request(app.getHttpServer())
        .post('/clinics')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Clínica Beta E2E',
          slug: 'clinic-beta-e2e',
          planType: PlanType.PRO,
          adminName: 'Admin Beta',
          adminEmail: clinicBetaAdminEmail,
          adminPassword: adminPassword,
        })
        .expect(201);

      expect(res.body.clinic.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
      expect(res.body.subscription.planType).toBe(PlanType.PRO);
      clinicBetaId = res.body.clinic.id;
    });
  });

  describe('E1.2: Authentication & Sessions (POST /auth/login, /auth/refresh)', () => {
    let rawRefreshToken: string;

    it('Rejects invalid password with 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: clinicAlfaAdminEmail,
          password: 'WrongPassword!',
        })
        .expect(401);
    });

    it('Logs in Clinic Admin and returns short-lived JWT and opaque refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: clinicAlfaAdminEmail,
          password: adminPassword,
        })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.expiresIn).toBe(900);
      expect(res.body.user.role).toBe(UserRole.CLINIC_ADMIN);
      expect(res.body.user.clinicId).toBe(clinicAlfaId);

      clinicAlfaAdminToken = res.body.accessToken;
      rawRefreshToken = res.body.refreshToken;
    });

    it('Allows authenticated access to /auth/me with valid token', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${clinicAlfaAdminToken}`)
        .expect(200);

      expect(res.body.email).toBe(clinicAlfaAdminEmail);
      expect(res.body.clinicId).toBe(clinicAlfaId);
    });

    it('Rotates refresh token on POST /auth/refresh (invalidating the previous one)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: rawRefreshToken })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      const newRefreshToken = res.body.refreshToken;

      // Valid rotation: rotating the new token succeeds
      const secondRotate = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: newRefreshToken })
        .expect(200);

      expect(secondRotate.body.accessToken).toBeDefined();

      // Replay attack: attempting to reuse already-rotated rawRefreshToken fails with 401
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: rawRefreshToken })
        .expect(401);
    });
  });

  describe('Password Recovery (POST /auth/forgot-password, /auth/reset-password)', () => {
    it('Dispatches password reset and updates password', async () => {
      const forgotRes = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: clinicAlfaAdminEmail })
        .expect(200);

      const resetToken = forgotRes.body.resetToken;
      expect(resetToken).toBeDefined();

      // Verify recovery email was dispatched (RF-026)
      const recoveryEmails = emailAdapter
        .getSentEmails()
        .filter((e) => e.to === clinicAlfaAdminEmail && e.subject.includes('Recuperación'));
      expect(recoveryEmails.length).toBeGreaterThan(0);
      expect(recoveryEmails[0].html).toContain(`reset-password?token=${resetToken}`);

      const newPassword = 'NewSecretPassword2026!';

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          token: resetToken,
          newPassword,
        })
        .expect(200);

      // Old password fails
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: clinicAlfaAdminEmail,
          password: adminPassword,
        })
        .expect(401);

      // New password succeeds
      const newLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: clinicAlfaAdminEmail,
          password: newPassword,
        })
        .expect(200);

      expect(newLogin.body.accessToken).toBeDefined();
      clinicAlfaAdminToken = newLogin.body.accessToken;
    });
  });

  describe('Authorization & Multi-Tenant Boundary (BOLA/BFLA Prevention)', () => {
    beforeAll(async () => {
      // Login as Clinic Beta Admin
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: clinicBetaAdminEmail,
          password: adminPassword,
        })
        .expect(200);

      clinicBetaAdminToken = res.body.accessToken;
    });

    it('Clinic Admin cannot create a new clinic (BFLA Forbidden: 403)', async () => {
      await request(app.getHttpServer())
        .post('/clinics')
        .set('Authorization', `Bearer ${clinicAlfaAdminToken}`)
        .send({
          name: 'Clínica Ilegal',
          slug: 'clinic-illegal',
          adminName: 'Hacker',
          adminEmail: 'hacker@test.com',
        })
        .expect(403);
    });

    it('Clinic Alfa Admin cannot view Clinic Beta tenant data (BOLA Forbidden: 403)', async () => {
      await request(app.getHttpServer())
        .get(`/clinics/${clinicBetaId}`)
        .set('Authorization', `Bearer ${clinicAlfaAdminToken}`)
        .expect(403);
    });

    it('Clinic Alfa Admin can view their own clinic data (200)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/clinics/${clinicAlfaId}`)
        .set('Authorization', `Bearer ${clinicAlfaAdminToken}`)
        .expect(200);

      expect(res.body.id).toBe(clinicAlfaId);
      expect(res.body.slug).toBe('clinic-alfa-e2e');
    });

    it('Super Admin can view any clinic tenant (200)', async () => {
      await request(app.getHttpServer())
        .get(`/clinics/${clinicAlfaId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/clinics/${clinicBetaId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
    });
  });
});
