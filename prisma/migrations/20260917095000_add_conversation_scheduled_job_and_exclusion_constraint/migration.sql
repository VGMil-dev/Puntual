-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVA', 'ESCALADA', 'RESUELTA', 'CERRADA');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT,
    "channelType" "ChannelType" NOT NULL,
    "channelThreadId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVA',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "executionDate" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_clinicId_channelType_channelThreadId_key" ON "conversations"("clinicId", "channelType", "channelThreadId");

-- CreateIndex
CREATE INDEX "conversations_clinicId_status_idx" ON "conversations"("clinicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_idempotencyKey_key" ON "scheduled_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "scheduled_jobs_clinicId_status_idx" ON "scheduled_jobs"("clinicId", "status");

-- CreateIndex
CREATE INDEX "scheduled_jobs_type_status_idx" ON "scheduled_jobs"("type", "status");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Partial Exclusion Constraint for Overlapping Active Appointments (RF-025, CU-001)
-- Enforces that no doctor can have overlapping SOLICITADA or CONFIRMADA appointments
ALTER TABLE "appointments" 
  ADD CONSTRAINT "appointment_no_overlapping_active_slots" 
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  ) 
  WHERE ("status" IN ('SOLICITADA', 'CONFIRMADA'));

