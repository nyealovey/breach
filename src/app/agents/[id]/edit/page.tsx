import { notFound } from 'next/navigation';

import { EditAgentClient } from './edit-agent-client';
import { getAgent } from '../../actions';

type EditAgentPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditAgentPage({ params }: EditAgentPageProps) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();
  return <EditAgentClient initialAgent={agent} />;
}
