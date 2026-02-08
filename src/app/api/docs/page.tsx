import { requireServerAdminSession } from '@/lib/auth/require-server-session';

import { ApiDocsClient } from './api-docs-client';

export default async function ApiDocsPage() {
  await requireServerAdminSession();
  return <ApiDocsClient />;
}
