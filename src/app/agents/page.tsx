import { AgentsClient } from './agents-client';
import { listAgents } from './actions';

export default async function AgentsPage() {
  const items = await listAgents({ pageSize: 100 });
  return <AgentsClient initialItems={items} />;
}
