import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import PageClient from './page.client';

export default async function Page() {
  await requireServerAdminSession();
  return <PageClient />;
}
