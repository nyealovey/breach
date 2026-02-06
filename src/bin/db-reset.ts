import { spawn } from 'node:child_process';

const ALLOW_NON_LOCAL_FLAG = 'ALLOW_NON_LOCAL_DB_SEED';
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function readDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error('DATABASE_URL is required.');
  return value;
}

function extractHostname(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function ensureSafeLocalDatabase(operation: string) {
  if (process.env[ALLOW_NON_LOCAL_FLAG] === 'true') return;

  const databaseUrl = readDatabaseUrl();
  const hostname = extractHostname(databaseUrl);
  if (hostname && LOCAL_DB_HOSTS.has(hostname)) return;

  throw new Error(
    `${operation} blocked: DATABASE_URL must target localhost/127.0.0.1/::1 (or host.docker.internal). ` +
      `Current host: ${hostname ?? 'invalid-url'}. ` +
      `If this is intentional, set ${ALLOW_NON_LOCAL_FLAG}=true.`,
  );
}

async function runPrismaReset() {
  await new Promise<void>((resolve, reject) => {
    const bunBin = process.execPath || 'bun';
    const child = spawn(bunBin, ['x', 'prisma', 'migrate', 'reset', '--force', '--skip-generate', '--skip-seed'], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prisma migrate reset failed with exit code ${code ?? 'null'}`));
    });
  });
}

async function main() {
  ensureSafeLocalDatabase('db:reset');
  await runPrismaReset();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[db-reset] ${message}`);
  process.exitCode = 1;
});
