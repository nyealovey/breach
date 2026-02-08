import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import EditSourceClientPage from './page.client';

export default async function EditSourcePage() {
  await requireServerAdminSession();
  return <EditSourceClientPage />;
}
