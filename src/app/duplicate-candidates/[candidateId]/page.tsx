import { requireServerAdminSession } from '@/lib/auth/require-server-session';
import { readDuplicateCandidatePageInitialData } from '@/lib/duplicate-candidates/server-data';

import PageClient from './page.client';

type DuplicateCandidateDetailPageProps = {
  params: Promise<{ candidateId: string }>;
};

export default async function Page({ params }: DuplicateCandidateDetailPageProps) {
  await requireServerAdminSession();
  const { candidateId } = await params;
  const initialData = await readDuplicateCandidatePageInitialData(candidateId);
  return <PageClient initialData={initialData} />;
}
