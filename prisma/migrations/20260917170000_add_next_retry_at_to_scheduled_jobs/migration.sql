-- AlterTable
ALTER TABLE "scheduled_jobs" ADD COLUMN "nextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "scheduled_jobs_type_status_nextRetryAt_idx" ON "scheduled_jobs"("type", "status", "nextRetryAt");
