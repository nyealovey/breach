import ScheduleGroupsClientPage from './page.client';
import { listScheduleGroups } from './actions';

export default async function ScheduleGroupsPage() {
  const groups = await listScheduleGroups({ pageSize: 100 });
  return <ScheduleGroupsClientPage initialGroups={groups} />;
}
