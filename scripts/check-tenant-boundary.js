/**
 * Tenant Boundary Linter (E11.3 / RNF-001)
 *
 * Scans the codebase for Prisma queries on tenant-scoped models:
 * - appointment
 * - patient
 * - doctor
 * - user
 *
 * Verifies that findMany, findFirst, updateMany, and deleteMany queries include `clinicId` in their where clause.
 * Fails with exit code 1 if an un-scoped query is detected.
 */

const fs = require('fs');
const path = require('path');

const TENANT_MODELS = ['appointment', 'patient', 'doctor', 'user'];
const RESTRICTED_METHODS = ['findMany', 'findFirst', 'updateMany', 'deleteMany'];

const IGNORED_PATHS = [
  path.normalize('test/'),
  path.normalize('prisma/'),
  path.normalize('dist/'),
  path.normalize('node_modules/'),
  path.normalize('scripts/'),
];

function getAllTsFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!IGNORED_PATHS.some((ignored) => filePath.includes(ignored))) {
        getAllTsFiles(filePath, fileList);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function checkTenantIsolation(files) {
  const violations = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const model of TENANT_MODELS) {
        for (const method of RESTRICTED_METHODS) {
          const pattern = new RegExp(`\\bprisma\\.${model}\\.${method}\\s*\\(`, 'i');
          if (pattern.test(line)) {
            // Check following lines (up to 15 lines) for clinicId
            const windowEnd = Math.min(lines.length, i + 15);
            const queryChunk = lines.slice(i, windowEnd).join('\n');

            // Look for clinicId inside the query chunk
            if (!queryChunk.includes('clinicId') && !queryChunk.includes('// bypass-tenant-check:')) {
              violations.push({
                file: filePath,
                line: i + 1,
                snippet: line.trim(),
                model,
                method,
              });
            }
          }
        }
      }
    }
  }

  return violations;
}

function run() {
  const targetDir = path.resolve(__dirname, '../apps/api/src');
  console.log(`[Tenant Boundary Linter] Scanning files in: ${targetDir}`);

  const files = getAllTsFiles(targetDir);
  console.log(`[Tenant Boundary Linter] Found ${files.length} TypeScript files to inspect.`);

  const violations = checkTenantIsolation(files);

  if (violations.length > 0) {
    console.error('\n❌ TENANT ISOLATION VIOLATIONS DETECTED (RNF-001):');
    for (const v of violations) {
      console.error(` - [${v.file}:${v.line}] Call to prisma.${v.model}.${v.method} is missing 'clinicId' filter!`);
      console.error(`   Snippet: "${v.snippet}"`);
    }
    console.error('\nFix: Always include `clinicId` in queries for tenant entities, or document explicit SuperAdmin bypass.\n');
    process.exit(1);
  } else {
    console.log('✅ All tenant model queries properly enforce clinicId boundary.\n');
    process.exit(0);
  }
}

run();
