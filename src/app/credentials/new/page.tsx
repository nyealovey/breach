import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import NewCredentialClientPage from './page.client';

export default async function NewCredentialPage() {
  await requireServerAdminSession();
  return <NewCredentialClientPage />;
}
