import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth/server-session';

import PageClient from './page.client';

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) redirect('/login');

  return (
    <PageClient
      initialUser={{
        userId: session.user.id,
        username: session.user.username,
        role: session.user.role,
        authType: session.user.authType,
      }}
    />
  );
}
