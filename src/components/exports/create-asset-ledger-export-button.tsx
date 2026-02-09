'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { createAssetLedgerExportAction } from '@/lib/actions/exports';

import type { ButtonProps } from '@/components/ui/button';

type Props = Pick<ButtonProps, 'size' | 'variant' | 'className' | 'children' | 'title' | 'aria-label'>;

export function CreateAssetLedgerExportButton({
  size,
  variant,
  className,
  children,
  title,
  'aria-label': ariaLabel,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const onClick = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const result = await createAssetLedgerExportAction({ format: 'csv', version: 'asset-ledger-export-v1' });
      if (!result.ok) {
        toast.error(result.error ?? '创建导出任务失败');
        return;
      }

      toast.success('已创建导出任务');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const defaultLabel = '导出台账 CSV';
  const resolvedTitle = title ?? defaultLabel;
  const resolvedAriaLabel = ariaLabel ?? defaultLabel;

  return (
    <Button
      onClick={onClick}
      disabled={submitting}
      size={size}
      variant={variant}
      className={className}
      title={resolvedTitle}
      aria-label={resolvedAriaLabel}
    >
      {children ?? (submitting ? '创建中…' : defaultLabel)}
    </Button>
  );
}
