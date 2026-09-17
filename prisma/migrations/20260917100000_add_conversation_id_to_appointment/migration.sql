-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "conversationId" TEXT;

-- CreateIndex
CREATE INDEX "appointments_clinicId_conversationId_idx" ON "appointments"("clinicId", "conversationId");
