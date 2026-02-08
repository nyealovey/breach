import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import { CredentialsClient } from './credentials-client';

export default async function CredentialsPage() {
  await requireServerAdminSession();
  return <CredentialsClient />;
}
