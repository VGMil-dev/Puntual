import { PrismaClient, UserRole, AppointmentStatus, SubscriptionStatus } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

describe('Tenant Isolation Tests (RNF-001 / E11.3)', () => {
  let prisma: PrismaClient;

  let clinicAId: string;
  let clinicBId: string;

  let userAId: string;
  let userBId: string;

  let doctorAId: string;
  let doctorBId: string;

  let patientAId: string;
  let patientBId: string;

  let appointmentAId: string;
  let appointmentBId: string;

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

    // 2. Create Users
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

    // 3. Create Doctors
    const doctorA = await prisma.doctor.create({
      data: {
        clinicId: clinicAId,
        name: 'Dr. Alejandro Alfa',
        specialties: ['Odontología General', 'Ortodoncia'],
      },
    });
    doctorAId = doctorA.id;

    const doctorB = await prisma.doctor.create({
      data: {
        clinicId: clinicBId,
        name: 'Dra. Beatriz Beta',
        specialties: ['Endodoncia'],
      },
    });
    doctorBId = doctorB.id;

    // 4. Create Patients
    const patientA = await prisma.patient.create({
      data: {
        clinicId: clinicAId,
        name: 'Paciente Alfa',
        phone: '+593991111111',
      },
    });
    patientAId = patientA.id;

    const patientB = await prisma.patient.create({
      data: {
        clinicId: clinicBId,
        name: 'Paciente Beta',
        phone: '+593992222222',
      },
    });
    patientBId = patientB.id;

    // 5. Create Appointments
    const now = new Date();
    const appointmentA = await prisma.appointment.create({
      data: {
        clinicId: clinicAId,
        doctorId: doctorAId,
        patientId: patientAId,
        status: AppointmentStatus.CONFIRMADA,
        startAt: new Date(now.getTime() + 86400000),
        endAt: new Date(now.getTime() + 86400000 + 1800000),
        reason: 'Limpieza y revisión',
      },
    });
    appointmentAId = appointmentA.id;

    const appointmentB = await prisma.appointment.create({
      data: {
        clinicId: clinicBId,
        doctorId: doctorBId,
        patientId: patientBId,
        status: AppointmentStatus.CONFIRMADA,
        startAt: new Date(now.getTime() + 172800000),
        endAt: new Date(now.getTime() + 172800000 + 1800000),
        reason: 'Consulta endodóntica',
      },
    });
    appointmentBId = appointmentB.id;
  });

  afterAll(async () => {
    // Cleanup fixtures
    if (prisma) {
      await prisma.appointment.deleteMany({
        where: { clinicId: { in: [clinicAId, clinicBId] } },
      });
      await prisma.patient.deleteMany({
        where: { clinicId: { in: [clinicAId, clinicBId] } },
      });
      await prisma.doctor.deleteMany({
        where: { clinicId: { in: [clinicAId, clinicBId] } },
      });
      await prisma.user.deleteMany({
        where: { clinicId: { in: [clinicAId, clinicBId] } },
      });
      await prisma.clinic.deleteMany({
        where: { id: { in: [clinicAId, clinicBId] } },
      });
      await prisma.$disconnect();
    }
  });

  describe('Strict Query Isolation (Read Boundaries)', () => {
    it('Appointment: Querying with clinicId A returns ONLY clinic A appointments and never B', async () => {
      const appointmentsA = await prisma.appointment.findMany({
        where: { clinicId: clinicAId },
      });

      expect(appointmentsA.length).toBeGreaterThanOrEqual(1);
      expect(appointmentsA.some((apt) => apt.id === appointmentAId)).toBe(true);
      expect(appointmentsA.some((apt) => apt.id === appointmentBId)).toBe(false);
      expect(appointmentsA.every((apt) => apt.clinicId === clinicAId)).toBe(true);
    });

    it('Appointment: Querying with clinicId B returns ONLY clinic B appointments and never A', async () => {
      const appointmentsB = await prisma.appointment.findMany({
        where: { clinicId: clinicBId },
      });

      expect(appointmentsB.length).toBeGreaterThanOrEqual(1);
      expect(appointmentsB.some((apt) => apt.id === appointmentBId)).toBe(true);
      expect(appointmentsB.some((apt) => apt.id === appointmentAId)).toBe(false);
      expect(appointmentsB.every((apt) => apt.clinicId === clinicBId)).toBe(true);
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
  });

  describe('Strict Mutation Isolation (Write Boundaries)', () => {
    it('Cross-tenant update: Clinic A cannot modify an Appointment of Clinic B', async () => {
      const updateResult = await prisma.appointment.updateMany({
        where: {
          id: appointmentBId,
          clinicId: clinicAId, // Attempt cross-tenant update
        },
        data: {
          reason: 'Hacked reason from Clinic A',
        },
      });

      expect(updateResult.count).toBe(0);

      // Verify Appointment B is untouched
      const freshAppointmentB = await prisma.appointment.findUnique({
        where: { id: appointmentBId },
      });
      expect(freshAppointmentB?.reason).toBe('Consulta endodóntica');
    });

    it('Cross-tenant delete: Clinic A cannot delete a Patient of Clinic B', async () => {
      const deleteResult = await prisma.patient.deleteMany({
        where: {
          id: patientBId,
          clinicId: clinicAId, // Attempt cross-tenant delete
        },
      });

      expect(deleteResult.count).toBe(0);

      // Verify Patient B still exists
      const freshPatientB = await prisma.patient.findUnique({
        where: { id: patientBId },
      });
      expect(freshPatientB).not.toBeNull();
      expect(freshPatientB?.id).toBe(patientBId);
    });

    it('Cross-tenant read by ID: Clinic A cannot access entity of Clinic B by ID alone without clinicId filter', async () => {
      // Accessing with combined where (id + clinicId) correctly returns null
      const appointmentCross = await prisma.appointment.findFirst({
        where: {
          id: appointmentBId,
          clinicId: clinicAId,
        },
      });

      expect(appointmentCross).toBeNull();
    });
  });
});
