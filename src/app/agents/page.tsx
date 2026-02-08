import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import { AgentsClient } from './agents-client';

export default async function AgentsPage() {
  await requireServerAdminSession();
  return <AgentsClient />;
}
