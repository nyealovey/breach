import { CredentialsClient } from './credentials-client';
import { listCredentials } from './actions';

export default async function CredentialsPage() {
  const items = await listCredentials({ pageSize: 100 });
  return <CredentialsClient initialItems={items} />;
}
