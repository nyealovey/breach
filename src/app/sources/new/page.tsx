import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { listCredentials } from '@/app/credentials/actions';
import { SourceType } from '@prisma/client';

import NewSourceClientPage from './page.client';

import type { NewSourcePageInitialData } from '@/lib/sources/page-data';

export default async function NewSourcePage() {
  await requireServerAdminSession();

  const credentials = await listCredentials({ type: SourceType.vcenter, pageSize: 100 });
  const initialData: NewSourcePageInitialData = {
    credentials: credentials
      .map((item) => ({ credentialId: item.credentialId, name: item.name, type: item.type }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  };

  return <NewSourceClientPage initialData={initialData} />;
}
