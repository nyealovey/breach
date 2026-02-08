import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth/server-session';

export async function requireServerSession() {
  const session = await getServerSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireServerAdminSession() {
  const session = await requireServerSession();
  if (session.user.role !== 'admin') redirect('/assets');
  return session;
}
