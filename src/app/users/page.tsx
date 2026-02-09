import PageClient from './page.client';
import { listUsers } from './actions';

export default async function Page() {
  const items = await listUsers({ pageSize: 200 });
  return <PageClient initialItems={items} />;
}
