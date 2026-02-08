import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import EditCredentialClientPage from './page.client';

export default async function EditCredentialPage() {
  await requireServerAdminSession();
  return <EditCredentialClientPage />;
}
