import bcrypt from 'bcryptjs';

import { serverEnv } from '@/lib/env/server';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, serverEnv.BCRYPT_LOG_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

