import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import ScheduleGroupsClientPage from './page.client';

export default async function ScheduleGroupsPage() {
  await requireServerAdminSession();
  return <ScheduleGroupsClientPage />;
}
