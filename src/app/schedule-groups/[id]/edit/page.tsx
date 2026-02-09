import { notFound } from 'next/navigation';

import PageClient from './page.client';
import { getScheduleGroup, listEnabledSourcesForScheduleGroup } from '../../actions';

type ScheduleGroupEditPageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: ScheduleGroupEditPageProps) {
  const { id } = await params;
  const [group, sources] = await Promise.all([getScheduleGroup(id), listEnabledSourcesForScheduleGroup()]);
  if (!group) notFound();
  return <PageClient initialGroup={group} initialSources={sources} />;
}
