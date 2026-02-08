import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import NewSourceClientPage from './page.client';

export default async function NewSourcePage() {
  await requireServerAdminSession();
  return <NewSourceClientPage />;
}
