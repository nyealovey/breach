import { notFound } from 'next/navigation';

import EditCredentialClientPage from './page.client';
import { getCredential } from '../../actions';

type EditCredentialPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCredentialPage({ params }: EditCredentialPageProps) {
  const { id } = await params;
  const credential = await getCredential(id);
  if (!credential) notFound();
  return <EditCredentialClientPage initialCredential={credential} />;
}
