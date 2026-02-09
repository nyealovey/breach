import NewScheduleGroupClientPage from './page.client';
import { listEnabledSourcesForScheduleGroup } from '../actions';

export default async function NewScheduleGroupPage() {
  const sources = await listEnabledSourcesForScheduleGroup();
  return <NewScheduleGroupClientPage initialSources={sources} />;
}
