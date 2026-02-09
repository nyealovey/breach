import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth/server-session';

import PageClient from './page.client';

export default async function LoginPage() {
  const session = await getServerSession();
  if (session) redirect('/assets');

  return <PageClient />;
}
