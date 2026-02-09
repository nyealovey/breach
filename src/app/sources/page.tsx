import { SourcesClient } from './sources-client';
import { listSources } from './actions';

export default async function SourcesPage() {
  const items = await listSources();
  return <SourcesClient initialItems={items} />;
}
