'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import type { ButtonProps } from '@/components/ui/button';

type Props = Pick<ButtonProps, 'size' | 'variant' | 'className' | 'children'>;

export function CreateAssetLedgerExportButton({ size, variant, className, children }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const onClick = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/v1/exports/asset-ledger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'csv', version: 'asset-ledger-export-v1' }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '创建导出任务失败');
        return;
      }

      toast.success('已创建导出任务');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Button onClick={onClick} disabled={submitting} size={size} variant={variant} className={className}>
      {submitting ? '创建中…' : (children ?? '导出台账 CSV')}
    </Button>
  );
}
