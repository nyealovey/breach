import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import { NewAgentClient } from './new-agent-client';

export default async function NewAgentPage() {
  await requireServerAdminSession();
  return <NewAgentClient />;
}
