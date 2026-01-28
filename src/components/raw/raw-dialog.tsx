'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type RawResponse = {
  rawPayload: unknown;
  meta: {
    hash: string;
    sizeBytes: number;
    compression: string;
    collectedAt: string;
    runId: string;
    sourceId: string;
  };
};

type Props = {
  recordId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RawDialog({ recordId, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RawResponse | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!open || !recordId) return;

      setLoading(true);
      setError(null);
      setData(null);

      const res = await fetch(`/api/v1/source-records/${recordId}/raw`);
      if (!res.ok) {
        const msg = res.status === 403 ? '无权限查看 raw。' : '加载 raw 失败。';
        if (active) {
          setError(msg);
          setLoading(false);
        }
        return;
      }

      const body = (await res.json()) as { data: RawResponse };
      if (active) {
        setData(body.data ?? null);
        setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [open, recordId]);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data.rawPayload, null, 2));
    } catch {
      // ignore
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Raw Payload</DialogTitle>
        </DialogHeader>

        {!recordId ? (
          <div className="text-sm text-muted-foreground">未选择记录。</div>
        ) : loading ? (
          <div className="text-sm text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="text-sm text-muted-foreground">{error}</div>
        ) : !data ? (
          <div className="text-sm text-muted-foreground">暂无数据。</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div>recordId: {recordId}</div>
              <div>sourceId: {data.meta.sourceId}</div>
              <div>runId: {data.meta.runId}</div>
              <div>collectedAt: {data.meta.collectedAt}</div>
              <div>
                hash: {data.meta.hash} · sizeBytes: {data.meta.sizeBytes} · compression: {data.meta.compression}
              </div>
            </div>

            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={copy}>
                复制 JSON
              </Button>
            </div>

            <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(data.rawPayload, null, 2)}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
