import { notFound } from 'next/navigation';

import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { listAgents } from '@/app/agents/actions';
import { listCredentials } from '@/app/credentials/actions';
import { getSource } from '@/app/sources/actions';
import { SourceType } from '@prisma/client';

import EditSourceClientPage from './page.client';

import type { EditSourcePageInitialData } from '@/lib/sources/page-data';

type EditSourcePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditSourcePage({ params }: EditSourcePageProps) {
  await requireServerAdminSession();
  const { id } = await params;
  const source = await getSource(id);
  if (!source) notFound();

  const [credentials, hypervAgents] = await Promise.all([
    listCredentials({ type: source.sourceType, pageSize: 100 }),
    source.sourceType === SourceType.hyperv && source.config?.connection_method === 'agent'
      ? listAgents({ agentType: 'hyperv', enabled: true, pageSize: 100 })
      : Promise.resolve([]),
  ]);

  const initialData: EditSourcePageInitialData = {
    source,
    credentials: credentials
      .map((item) => ({ credentialId: item.credentialId, name: item.name, type: item.type }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    hypervAgents: hypervAgents
      .map((item) => ({
        agentId: item.agentId,
        name: item.name,
        agentType: item.agentType,
        endpoint: item.endpoint,
        enabled: item.enabled,
        tlsVerify: item.tlsVerify,
        timeoutMs: item.timeoutMs,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  };

  return <EditSourceClientPage initialData={initialData} />;
}
