'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

type RequireAdminClientProps = {
  redirectTo?: string;
};

export function RequireAdminClient({ redirectTo = '/assets' }: RequireAdminClientProps) {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const run = async () => {
      const res = await fetch('/api/v1/auth/me');
      if (!res.ok) {
        if (active) router.replace('/login');
        return;
      }

      const body = (await res.json().catch(() => null)) as { data?: { role?: unknown } } | null;
      const role = body?.data?.role;
      if (role !== 'admin') router.replace(redirectTo);
    };

    void run();
    return () => {
      active = false;
    };
  }, [redirectTo, router]);

  return null;
}
