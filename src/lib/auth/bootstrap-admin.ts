import { prisma } from '@/lib/db/prisma';
import { serverEnv } from '@/lib/env/server';

import { hashPassword } from './password';

export async function bootstrapAdmin() {
  const existing = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (existing) {
    if (existing.authType !== 'local' || !existing.enabled) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { authType: 'local', enabled: true, externalAuthId: null },
      });
    }
    return existing;
  }

  const plain = serverEnv.ASSET_LEDGER_ADMIN_PASSWORD;
  if (!plain) {
    const msg = 'ASSET_LEDGER_ADMIN_PASSWORD is required to bootstrap the default admin user (username=admin).';
    // In production we should fail fast; in web route handlers we surface as 500.
    console.error(msg);
    throw new Error(msg);
  }

  const passwordHash = await hashPassword(plain);

  try {
    return await prisma.user.create({
      data: { username: 'admin', role: 'admin', authType: 'local', enabled: true, externalAuthId: null, passwordHash },
    });
  } catch (err) {
    // If concurrent bootstrap happens, treat "already exists" as success.
    const again = await prisma.user.findUnique({ where: { username: 'admin' } });
    if (again) return again;
    throw err;
  }
}
