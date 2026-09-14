/**
 * Verifies that the tenant linter blocks un-isolated Prisma queries (E11.3 Acceptance Criteria)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const badFilePath = path.resolve(__dirname, '../apps/api/src/modules/health/bad-query-test.ts');

console.log('[Test Tenant Linter Blocking] Injecting intentional un-isolated query...');

// Write an intentional tenant violation (missing clinicId)
fs.writeFileSync(
  badFilePath,
  `
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export async function leakAppointments() {
  return await prisma.appointment.findMany({
    where: { status: 'CONFIRMADA' }
  });
}
`
);

let caughtError = false;

try {
  console.log('[Test Tenant Linter Blocking] Running linter on intentionally bad query...');
  execSync('node scripts/check-tenant-boundary.js', { stdio: 'pipe' });
} catch (err) {
  caughtError = true;
  const output = err.stderr ? err.stderr.toString() : err.stdout.toString();
  console.log('[Test Tenant Linter Blocking] Successfully blocked! Output received:\n' + output);
} finally {
  if (fs.existsSync(badFilePath)) {
    fs.unlinkSync(badFilePath);
  }
}

if (!caughtError) {
  console.error('❌ FAIL: Linter failed to catch un-isolated query!');
  process.exit(1);
} else {
  console.log('✅ PASS: Linter successfully detected and blocked un-isolated query with non-zero exit code.');
}
