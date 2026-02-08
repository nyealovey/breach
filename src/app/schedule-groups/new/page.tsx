import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import NewScheduleGroupClientPage from './page.client';

export default async function NewScheduleGroupPage() {
  await requireServerAdminSession();
  return <NewScheduleGroupClientPage />;
}
