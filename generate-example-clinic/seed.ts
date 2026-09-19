import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import {
  PrismaClient,
  SubscriptionStatus,
  PlanType,
  UserRole,
  ChannelType,
} from '@prisma/client';

// Load environment variables prioritizing local .env, then root .env
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

// ============================================================================
// AES-256-GCM — Idéntico a ChannelsService de Puntual
// ============================================================================
// Deriva la clave de 32 bytes con SHA-256 sobre la clave maestra (RNF-012)
// y cifra usando AES-256-GCM con IV de 16 bytes y tag de autenticación.
function getDerivedEncryptionKey(rawKey: string): Buffer {
  if (!rawKey || rawKey.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY debe estar configurada y tener al menos 32 caracteres (RNF-012)',
    );
  }
  return crypto.createHash('sha256').update(rawKey).digest();
}

function encryptToken(plainText: string, encryptionKey: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

// ============================================================================
// Validación de entorno (fail-fast)
// ============================================================================
function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Falta variable de entorno obligatoria: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    return undefined;
  }
  return value.trim();
}

// ============================================================================
// Seed principal
// ============================================================================
async function main() {
  console.log('🚀 Iniciando seed de clínica de prueba sandbox...');

  // 1. Validar variables críticas
  const rawEncryptionKey = requireEnv('ENCRYPTION_KEY');
  if (rawEncryptionKey === '0'.repeat(64)) {
    throw new Error(
      'Debes reemplazar ENCRYPTION_KEY por la clave real del .env raíz antes de continuar.',
    );
  }

  requireEnv('DATABASE_URL');

  const clinicId = requireEnv('TEST_CLINIC_ID', 'test-clinic-sandbox');
  const clinicName = requireEnv('TEST_CLINIC_NAME', 'Clínica Sandbox Local');
  const clinicEmail = requireEnv('TEST_CLINIC_EMAIL', 'sandbox@example.local');
  const doctorName = requireEnv('TEST_DOCTOR_NAME', 'Dr. Sandbox Local');
  const doctorEmail = requireEnv('TEST_DOCTOR_EMAIL', 'doctor.sandbox@example.local');

  const phoneNumberId = requireEnv('META_SANDBOX_PHONE_NUMBER_ID');
  const accessToken = requireEnv('META_SANDBOX_ACCESS_TOKEN');
  const appSecret = requireEnv('META_SANDBOX_APP_SECRET');
  const verifyToken = requireEnv('META_SANDBOX_VERIFY_TOKEN');
  const testRecipient = requireEnv('META_SANDBOX_TEST_RECIPIENT');

  if (!accessToken || accessToken.length < 20) {
    throw new Error(
      'META_SANDBOX_ACCESS_TOKEN inválido o demasiado corto (>20 caracteres requeridos). Configura tu token real de Meta.',
    );
  }

  if (!appSecret || appSecret.length < 32) {
    throw new Error(
      'META_SANDBOX_APP_SECRET inválido o demasiado corto (mínimo 32 caracteres). Configura tu App Secret real.',
    );
  }

  // Google Calendar (opcional)
  const googleCalendarId = optionalEnv('GOOGLE_TEST_CALENDAR_ID');
  const rawGoogleRefreshToken = optionalEnv('GOOGLE_TEST_REFRESH_TOKEN_CIPHER');

  // 2. Preparar cifrado
  const derivedKey = getDerivedEncryptionKey(rawEncryptionKey);

  // Formato esperado por ChannelGatewayService: { token, appSecret, verifyToken }
  const metaPayload = JSON.stringify({
    token: accessToken,
    appSecret: appSecret,
    verifyToken: verifyToken,
  });
  const encryptedMetaToken = encryptToken(metaPayload, derivedKey);

  // Si se proveyó refresh token de Google, cifrar si no viene ya cifrado (iv:tag:cipher)
  let googleRefreshTokenCipher: string | null = null;
  if (rawGoogleRefreshToken) {
    const parts = rawGoogleRefreshToken.split(':');
    if (parts.length === 3) {
      googleRefreshTokenCipher = rawGoogleRefreshToken;
    } else {
      googleRefreshTokenCipher = encryptToken(rawGoogleRefreshToken, derivedKey);
    }
  }

  const clinicSlug = clinicId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const trialEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 días de prueba

  // 3. Transacción atómica e idempotente en Prisma
  const result = await prisma.$transaction(async (tx) => {
    // A. Clinic
    const clinic = await tx.clinic.upsert({
      where: { id: clinicId },
      update: {
        name: clinicName,
        slug: clinicSlug,
        whatsappPhoneNumberId: phoneNumberId,
        googleCalendarId: googleCalendarId || undefined,
        subscriptionStatus: SubscriptionStatus.TRIAL,
      },
      create: {
        id: clinicId,
        name: clinicName,
        slug: clinicSlug,
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialEndsAt,
        gracePeriodDays: 5,
        whatsappPhoneNumberId: phoneNumberId,
        googleCalendarId: googleCalendarId || undefined,
        defaultSlotDurationMinutes: 30,
        maxConcurrentHolds: 3,
      },
    });

    // B. Subscription
    const subscription = await tx.subscription.upsert({
      where: { clinicId },
      update: {
        planType: PlanType.TRIAL,
        status: SubscriptionStatus.TRIAL,
        trialEndsAt,
      },
      create: {
        clinicId,
        planType: PlanType.TRIAL,
        status: SubscriptionStatus.TRIAL,
        trialEndsAt,
        gracePeriodDays: 5,
      },
    });

    // C. User (CLINIC_ADMIN)
    const tempPasswordHash = await bcrypt.hash('SandboxPass123!', 10);
    const user = await tx.user.upsert({
      where: { email: clinicEmail },
      update: {
        name: `Admin ${clinicName}`,
        role: UserRole.CLINIC_ADMIN,
        clinicId: clinic.id,
      },
      create: {
        email: clinicEmail,
        name: `Admin ${clinicName}`,
        role: UserRole.CLINIC_ADMIN,
        clinicId: clinic.id,
        passwordHash: tempPasswordHash,
      },
    });

    // D. Specialty
    const specialtyName = 'Odontología General';
    const specialty = await tx.specialty.upsert({
      where: {
        clinicId_name: {
          clinicId: clinic.id,
          name: specialtyName,
        },
      },
      update: {
        defaultSlotDurationMinutes: 30,
      },
      create: {
        clinicId: clinic.id,
        name: specialtyName,
        defaultSlotDurationMinutes: 30,
      },
    });

    // E. Doctor
    const doctorId = `doctor-${clinicId}`;
    const doctor = await tx.doctor.upsert({
      where: { id: doctorId },
      update: {
        name: doctorName,
        email: doctorEmail,
        specialties: [specialtyName],
        googleCalendarId: googleCalendarId || null,
        googleRefreshTokenCipher: googleRefreshTokenCipher,
        googleCalendarWriteVerifiedAt:
          googleCalendarId && googleRefreshTokenCipher ? new Date() : null,
        slotDurationMinutes: 30,
        maxConcurrentHolds: 3,
      },
      create: {
        id: doctorId,
        clinicId: clinic.id,
        name: doctorName,
        email: doctorEmail,
        specialties: [specialtyName],
        googleCalendarId: googleCalendarId || null,
        googleRefreshTokenCipher: googleRefreshTokenCipher,
        googleCalendarWriteVerifiedAt:
          googleCalendarId && googleRefreshTokenCipher ? new Date() : null,
        slotDurationMinutes: 30,
        maxConcurrentHolds: 3,
      },
    });

    // Vincular DoctorSpecialty
    await tx.doctorSpecialty.upsert({
      where: {
        doctorId_specialtyId: {
          doctorId: doctor.id,
          specialtyId: specialty.id,
        },
      },
      update: {},
      create: {
        doctorId: doctor.id,
        specialtyId: specialty.id,
      },
    });

    // F. DoctorSchedule (L-V, 09:00–17:00 America/Guayaquil)
    const workDays = [1, 2, 3, 4, 5]; // Lunes a Viernes
    for (const day of workDays) {
      const scheduleId = `${doctor.id}-schedule-day-${day}`;
      await tx.doctorSchedule.upsert({
        where: { id: scheduleId },
        update: {
          startTime: '09:00',
          endTime: '17:00',
          slotDurationMinutes: 30,
        },
        create: {
          id: scheduleId,
          clinicId: clinic.id,
          doctorId: doctor.id,
          dayOfWeek: day,
          startTime: '09:00',
          endTime: '17:00',
          slotDurationMinutes: 30,
        },
      });
    }

    // G. Patient de prueba
    const patient = await tx.patient.upsert({
      where: {
        clinicId_phone: {
          clinicId: clinic.id,
          phone: testRecipient,
        },
      },
      update: {
        name: 'Paciente Sandbox Local',
      },
      create: {
        clinicId: clinic.id,
        name: 'Paciente Sandbox Local',
        phone: testRecipient,
      },
    });

    // H. ChannelCredential (WhatsApp)
    const channelCredential = await tx.channelCredential.upsert({
      where: {
        channelType_identifier: {
          channelType: ChannelType.WHATSAPP,
          identifier: phoneNumberId,
        },
      },
      update: {
        clinicId: clinic.id,
        encryptedToken: encryptedMetaToken,
        isActive: true,
      },
      create: {
        clinicId: clinic.id,
        channelType: ChannelType.WHATSAPP,
        identifier: phoneNumberId,
        encryptedToken: encryptedMetaToken,
        isActive: true,
      },
    });

    return {
      clinic,
      subscription,
      user,
      specialty,
      doctor,
      patient,
      channelCredential,
    };
  });

  // 4. Resumen final sin secretos expuestos
  console.log('\n' + '='.repeat(80));
  console.log('✅ CLÍNICA DE PRUEBA CREADA EXITOSAMENTE (SEED IDEMPOTENTE)');
  console.log('='.repeat(80));
  console.log(`- Clinic ID:            ${result.clinic.id} (${result.clinic.name})`);
  console.log(`- Clinic Slug:          ${result.clinic.slug}`);
  console.log(`- Doctor ID:            ${result.doctor.id} (${result.doctor.name})`);
  console.log(`- Admin User:           ${result.user.email} (Password: SandboxPass123!)`);
  console.log(`- Patient ID:           ${result.patient.id} (Teléfono: ${result.patient.phone})`);
  console.log(`- Channel Credential:   ${result.channelCredential.id}`);
  console.log(`  - Canal:              ${result.channelCredential.channelType}`);
  console.log(`  - Identifier:         ${result.channelCredential.identifier}`);
  console.log(`  - Token Cifrado:      AES-256-GCM (Payload protegido)`);
  console.log(
    `- Google Calendar:      ${
      googleCalendarId
        ? `Conectado (${googleCalendarId})`
        : 'No configurado (opcional)'
    }`,
  );
  console.log(`- Horario Doctor:       Lunes a Viernes, 09:00 - 17:00 (America/Guayaquil)`);
  console.log('-'.repeat(80));
  console.log('🚀 Listo para usar con CONV-01 (Conversation Handler)');
  console.log('='.repeat(80) + '\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Seed falló:', e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
