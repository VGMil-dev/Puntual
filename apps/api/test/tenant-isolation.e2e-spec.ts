import {
  PrismaClient,
  UserRole,
  AppointmentStatus,
  SubscriptionStatus,
  PlanType,
  ChannelType,
  ConversationStatus,
  JobStatus,
} from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

describe('Tenant Isolation Tests (RNF-001 / E11.3 — Extended for Sprint 2)', () => {
  let prisma: PrismaClient;

  let clinicAId: string;
  let clinicBId: string;

  let userAId: string;
  let userBId: string;

  let doctorAId: string;
  let doctorBId: string;

  let specialtyAId: string;
  let specialtyBId: string;

  let scheduleAId: string;
  let scheduleBId: string;

  let channelCredAId: string;
  let channelCredBId: string;

  let operationalLogAId: string;
  let operationalLogBId: string;

  let patientAId: string;
  let patientBId: string;

  let appointmentAId: string;
  let appointmentBId: string;

  let conversationAId: string;
  let conversationBId: string;

  let scheduledJobAId: string;
  let scheduledJobBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
    await prisma.$connect();

    // Clean up any test fixtures from previous runs
    await prisma.scheduledJob.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.conversation.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.operationalLog.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.channelCredential.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.doctorSchedule.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.doctorSpecialty.deleteMany({
      where: { doctor: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } } },
    });
    await prisma.specialty.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.subscription.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.appointment.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.patient.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.doctor.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } } },
    });
    await prisma.user.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.clinic.deleteMany({
      where: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } },
    });

    // 1. Create Clinic A & Clinic B (Fixtures)
    const clinicA = await prisma.clinic.create({
      data: {
        name: 'Clínica Alfa Test',
        slug: 'clinic-alfa-test',
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });
    clinicAId = clinicA.id;

    const clinicB = await prisma.clinic.create({
      data: {
        name: 'Clínica Beta Test',
        slug: 'clinic-beta-test',
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });
    clinicBId = clinicB.id;

    // 2. Create Subscriptions
    await prisma.subscription.create({
      data: {
        clinicId: clinicAId,
        planType: PlanType.PRO,
        status: SubscriptionStatus.ACTIVE,
      },
    });
    await prisma.subscription.create({
      data: {
        clinicId: clinicBId,
        planType: PlanType.TRIAL,
        status: SubscriptionStatus.TRIAL,
      },
    });

    // 3. Create Users
    const userA = await prisma.user.create({
      data: {
        clinicId: clinicAId,
        email: 'admin.alfa@test.com',
        name: 'Admin Alfa',
        passwordHash: 'hash_alfa',
        role: UserRole.CLINIC_ADMIN,
      },
    });
    userAId = userA.id;

    const userB = await prisma.user.create({
      data: {
        clinicId: clinicBId,
        email: 'admin.beta@test.com',
        name: 'Admin Beta',
        passwordHash: 'hash_beta',
        role: UserRole.CLINIC_ADMIN,
      },
    });
    userBId = userB.id;

    // 4. Create Specialties
    const specA = await prisma.specialty.create({
      data: {
        clinicId: clinicAId,
        name: 'Ortodoncia Avanzada',
        defaultSlotDurationMinutes: 45,
      },
    });
    specialtyAId = specA.id;

    const specB = await prisma.specialty.create({
      data: {
        clinicId: clinicBId,
        name: 'Implantología Beta',
        defaultSlotDurationMinutes: 60,
      },
    });
    specialtyBId = specB.id;

    // 5. Create Doctors
    const doctorA = await prisma.doctor.create({
      data: {
        clinicId: clinicAId,
        name: 'Dr. Alejandro Alfa',
        specialties: ['Odontología General', 'Ortodoncia'],
        doctorSpecialties: {
          create: [{ specialtyId: specialtyAId }],
        },
      },
    });
    doctorAId = doctorA.id;

    const doctorB = await prisma.doctor.create({
      data: {
        clinicId: clinicBId,
        name: 'Dra. Beatriz Beta',
        specialties: ['Endodoncia'],
        doctorSpecialties: {
          create: [{ specialtyId: specialtyBId }],
        },
      },
    });
    doctorBId = doctorB.id;

    // 6. Create Doctor Schedules
    const schedA = await prisma.doctorSchedule.create({
      data: {
        clinicId: clinicAId,
        doctorId: doctorAId,
        dayOfWeek: 1, // Monday
        startTime: '09:00',
        endTime: '13:00',
      },
    });
    scheduleAId = schedA.id;

    const schedB = await prisma.doctorSchedule.create({
      data: {
        clinicId: clinicBId,
        doctorId: doctorBId,
        dayOfWeek: 2, // Tuesday
        startTime: '14:00',
        endTime: '18:00',
      },
    });
    scheduleBId = schedB.id;

    // 7. Create Channel Credentials
    const credA = await prisma.channelCredential.create({
      data: {
        clinicId: clinicAId,
        channelType: ChannelType.WHATSAPP,
        identifier: '109988776655443',
        encryptedToken: 'mock_cipher_alfa',
      },
    });
    channelCredAId = credA.id;

    const credB = await prisma.channelCredential.create({
      data: {
        clinicId: clinicBId,
        channelType: ChannelType.WHATSAPP,
        identifier: '209988776655443',
        encryptedToken: 'mock_cipher_beta',
      },
    });
    channelCredBId = credB.id;

    // 8. Create Operational Logs
    const logA = await prisma.operationalLog.create({
      data: {
        traceId: 'trace-alfa-123',
        clinicId: clinicAId,
        level: 'info',
        category: 'auth',
        message: 'Admin Alfa login success',
      },
    });
    operationalLogAId = logA.id;

    const logB = await prisma.operationalLog.create({
      data: {
        traceId: 'trace-beta-456',
        clinicId: clinicBId,
        level: 'info',
        category: 'auth',
        message: 'Admin Beta login success',
      },
    });
    operationalLogBId = logB.id;

    // 9. Create Patients
    const patientA = await prisma.patient.create({
      data: {
        clinicId: clinicAId,
        name: 'Carlos Paciente Alfa',
        phone: '+593991111111',
      },
    });
    patientAId = patientA.id;

    const patientB = await prisma.patient.create({
      data: {
        clinicId: clinicBId,
        name: 'Diana Paciente Beta',
        phone: '+593992222222',
      },
    });
    patientBId = patientB.id;

    // 10. Create Appointments
    const appointmentA = await prisma.appointment.create({
      data: {
        clinicId: clinicAId,
        doctorId: doctorAId,
        patientId: patientAId,
        status: AppointmentStatus.CONFIRMADA,
        startAt: new Date('2026-10-01T14:00:00Z'),
        endAt: new Date('2026-10-01T14:30:00Z'),
        reason: 'Limpieza dental regular',
      },
    });
    appointmentAId = appointmentA.id;

    const appointmentB = await prisma.appointment.create({
      data: {
        clinicId: clinicBId,
        doctorId: doctorBId,
        patientId: patientBId,
        status: AppointmentStatus.SOLICITADA,
        startAt: new Date('2026-10-01T15:00:00Z'),
        endAt: new Date('2026-10-01T15:30:00Z'),
        reason: 'Consulta endodóntica',
      },
    });
    appointmentBId = appointmentB.id;

    // 11. Create Conversations
    const convA = await prisma.conversation.create({
      data: {
        clinicId: clinicAId,
        patientId: patientAId,
        channelType: ChannelType.WHATSAPP,
        channelThreadId: 'thread-alfa-1',
        status: ConversationStatus.ACTIVA,
      },
    });
    conversationAId = convA.id;

    const convB = await prisma.conversation.create({
      data: {
        clinicId: clinicBId,
        patientId: patientBId,
        channelType: ChannelType.WHATSAPP,
        channelThreadId: 'thread-beta-1',
        status: ConversationStatus.ACTIVA,
      },
    });
    conversationBId = convB.id;

    // 12. Create Scheduled Jobs
    const jobA = await prisma.scheduledJob.create({
      data: {
        clinicId: clinicAId,
        type: 'expiracion_hold',
        entityId: appointmentAId,
        executionDate: '2026-10-01',
        status: JobStatus.COMPLETED,
        idempotencyKey: `expiracion_hold:${clinicAId}:${appointmentAId}:2026-10-01`,
        attempts: 1,
      },
    });
    scheduledJobAId = jobA.id;

    const jobB = await prisma.scheduledJob.create({
      data: {
        clinicId: clinicBId,
        type: 'expiracion_hold',
        entityId: appointmentBId,
        executionDate: '2026-10-01',
        status: JobStatus.COMPLETED,
        idempotencyKey: `expiracion_hold:${clinicBId}:${appointmentBId}:2026-10-01`,
        attempts: 1,
      },
    });
    scheduledJobBId = jobB.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.scheduledJob.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.conversation.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.operationalLog.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.channelCredential.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.doctorSchedule.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.doctorSpecialty.deleteMany({
      where: { doctor: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } } },
    });
    await prisma.specialty.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.subscription.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.appointment.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.patient.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.doctor.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.user.deleteMany({
      where: { clinic: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } } },
    });
    await prisma.clinic.deleteMany({
      where: { slug: { in: ['clinic-alfa-test', 'clinic-beta-test'] } },
    });
    await prisma.$disconnect();
  });

  describe('Strict Query Isolation (Read Boundaries)', () => {
    it('Appointment: Querying with clinicId A returns ONLY clinic A appointments and never B', async () => {
      const appointmentsA = await prisma.appointment.findMany({
        where: { clinicId: clinicAId },
      });

      expect(appointmentsA.length).toBeGreaterThan(0);
      expect(appointmentsA.some((apt) => apt.id === appointmentAId)).toBe(true);
      expect(appointmentsA.some((apt) => apt.id === appointmentBId)).toBe(false);
      expect(appointmentsA.every((apt) => apt.clinicId === clinicAId)).toBe(true);
    });

    it('Patient: Querying with clinicId A returns ONLY clinic A patients and never B', async () => {
      const patientsA = await prisma.patient.findMany({
        where: { clinicId: clinicAId },
      });

      expect(patientsA.some((p) => p.id === patientAId)).toBe(true);
      expect(patientsA.some((p) => p.id === patientBId)).toBe(false);
      expect(patientsA.every((p) => p.clinicId === clinicAId)).toBe(true);
    });

    it('Doctor: Querying with clinicId A returns ONLY clinic A doctors and never B', async () => {
      const doctorsA = await prisma.doctor.findMany({
        where: { clinicId: clinicAId },
      });

      expect(doctorsA.some((d) => d.id === doctorAId)).toBe(true);
      expect(doctorsA.some((d) => d.id === doctorBId)).toBe(false);
      expect(doctorsA.every((d) => d.clinicId === clinicAId)).toBe(true);
    });

    it('User: Querying with clinicId A returns ONLY clinic A users and never B', async () => {
      const usersA = await prisma.user.findMany({
        where: { clinicId: clinicAId },
      });

      expect(usersA.some((u) => u.id === userAId)).toBe(true);
      expect(usersA.some((u) => u.id === userBId)).toBe(false);
      expect(usersA.every((u) => u.clinicId === clinicAId)).toBe(true);
    });

    it('Subscription: Querying with clinicId A returns ONLY clinic A subscription', async () => {
      const subA = await prisma.subscription.findUnique({
        where: { clinicId: clinicAId },
      });
      expect(subA).not.toBeNull();
      expect(subA?.planType).toBe(PlanType.PRO);

      const subCross = await prisma.subscription.findFirst({
        where: { clinicId: clinicAId, id: (await prisma.subscription.findUnique({ where: { clinicId: clinicBId } }))?.id },
      });
      expect(subCross).toBeNull();
    });

    it('Specialty: Querying with clinicId A returns ONLY clinic A specialties and never B', async () => {
      const specialtiesA = await prisma.specialty.findMany({
        where: { clinicId: clinicAId },
      });

      expect(specialtiesA.some((s) => s.id === specialtyAId)).toBe(true);
      expect(specialtiesA.some((s) => s.id === specialtyBId)).toBe(false);
      expect(specialtiesA.every((s) => s.clinicId === clinicAId)).toBe(true);
    });

    it('DoctorSchedule: Querying with clinicId A returns ONLY clinic A doctor schedules', async () => {
      const schedulesA = await prisma.doctorSchedule.findMany({
        where: { clinicId: clinicAId },
      });

      expect(schedulesA.some((s) => s.id === scheduleAId)).toBe(true);
      expect(schedulesA.some((s) => s.id === scheduleBId)).toBe(false);
      expect(schedulesA.every((s) => s.clinicId === clinicAId)).toBe(true);
    });

    it('ChannelCredential: Querying with clinicId A returns ONLY clinic A credentials', async () => {
      const credsA = await prisma.channelCredential.findMany({
        where: { clinicId: clinicAId },
      });

      expect(credsA.some((c) => c.id === channelCredAId)).toBe(true);
      expect(credsA.some((c) => c.id === channelCredBId)).toBe(false);
      expect(credsA.every((c) => c.clinicId === clinicAId)).toBe(true);
    });

    it('OperationalLog: Querying with clinicId A returns ONLY clinic A logs', async () => {
      const logsA = await prisma.operationalLog.findMany({
        where: { clinicId: clinicAId },
      });

      expect(logsA.some((l) => l.id === operationalLogAId)).toBe(true);
      expect(logsA.some((l) => l.id === operationalLogBId)).toBe(false);
      expect(logsA.every((l) => l.clinicId === clinicAId)).toBe(true);
    });

    it('Conversation: Querying with clinicId A returns ONLY clinic A conversations and never B', async () => {
      const convsA = await prisma.conversation.findMany({
        where: { clinicId: clinicAId },
      });

      expect(convsA.some((c) => c.id === conversationAId)).toBe(true);
      expect(convsA.some((c) => c.id === conversationBId)).toBe(false);
      expect(convsA.every((c) => c.clinicId === clinicAId)).toBe(true);
    });

    it('ScheduledJob: Querying with clinicId A returns ONLY clinic A scheduled jobs and never B', async () => {
      const jobsA = await prisma.scheduledJob.findMany({
        where: { clinicId: clinicAId },
      });

      expect(jobsA.some((j) => j.id === scheduledJobAId)).toBe(true);
      expect(jobsA.some((j) => j.id === scheduledJobBId)).toBe(false);
      expect(jobsA.every((j) => j.clinicId === clinicAId)).toBe(true);
    });
  });

  describe('Strict Mutation Isolation (Write Boundaries)', () => {
    it('Cross-tenant update: Clinic A cannot modify an Appointment of Clinic B', async () => {
      const updateResult = await prisma.appointment.updateMany({
        where: {
          id: appointmentBId,
          clinicId: clinicAId,
        },
        data: {
          reason: 'Hacked reason from Clinic A',
        },
      });

      expect(updateResult.count).toBe(0);

      const freshAppointmentB = await prisma.appointment.findUnique({
        where: { id: appointmentBId },
      });
      expect(freshAppointmentB?.reason).toBe('Consulta endodóntica');
    });

    it('Cross-tenant update: Clinic A cannot modify a Specialty of Clinic B', async () => {
      const updateResult = await prisma.specialty.updateMany({
        where: {
          id: specialtyBId,
          clinicId: clinicAId,
        },
        data: {
          name: 'Hacked Specialty Name',
        },
      });

      expect(updateResult.count).toBe(0);

      const freshSpecialtyB = await prisma.specialty.findUnique({
        where: { id: specialtyBId },
      });
      expect(freshSpecialtyB?.name).toBe('Implantología Beta');
    });

    it('Cross-tenant delete: Clinic A cannot delete ChannelCredential of Clinic B', async () => {
      const deleteResult = await prisma.channelCredential.deleteMany({
        where: {
          id: channelCredBId,
          clinicId: clinicAId,
        },
      });

      expect(deleteResult.count).toBe(0);

      const freshCredB = await prisma.channelCredential.findUnique({
        where: { id: channelCredBId },
      });
      expect(freshCredB).not.toBeNull();
    });

    it('Cross-tenant delete: Clinic A cannot delete a DoctorSchedule of Clinic B', async () => {
      const deleteResult = await prisma.doctorSchedule.deleteMany({
        where: {
          id: scheduleBId,
          clinicId: clinicAId,
        },
      });

      expect(deleteResult.count).toBe(0);

      const freshSchedB = await prisma.doctorSchedule.findUnique({
        where: { id: scheduleBId },
      });
      expect(freshSchedB).not.toBeNull();
    });

    it('Cross-tenant update: Clinic A cannot modify a Conversation of Clinic B', async () => {
      const updateResult = await prisma.conversation.updateMany({
        where: {
          id: conversationBId,
          clinicId: clinicAId,
        },
        data: {
          status: ConversationStatus.CERRADA,
        },
      });

      expect(updateResult.count).toBe(0);

      const freshConvB = await prisma.conversation.findUnique({
        where: { id: conversationBId },
      });
      expect(freshConvB?.status).toBe(ConversationStatus.ACTIVA);
    });

    it('Cross-tenant delete: Clinic A cannot delete a ScheduledJob of Clinic B', async () => {
      const deleteResult = await prisma.scheduledJob.deleteMany({
        where: {
          id: scheduledJobBId,
          clinicId: clinicAId,
        },
      });

      expect(deleteResult.count).toBe(0);

      const freshJobB = await prisma.scheduledJob.findUnique({
        where: { id: scheduledJobBId },
      });
      expect(freshJobB).not.toBeNull();
    });
  });
});

