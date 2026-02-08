import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import { EditAgentClient } from './edit-agent-client';

export default async function EditAgentPage() {
  await requireServerAdminSession();
  return <EditAgentClient />;
}
