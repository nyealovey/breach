import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import { SourcesClient } from './sources-client';

export default async function SourcesPage() {
  await requireServerAdminSession();
  return <SourcesClient />;
}
