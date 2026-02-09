'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { getSourceRecordNormalizedAction, getSourceRecordRawAction } from '@/lib/actions/source-records';

import type { SourceRecordNormalizedResult, SourceRecordRawResult } from '@/lib/actions/source-records';

type NormalizedResponse = SourceRecordNormalizedResult;

type RawResponse = SourceRecordRawResult;

function parseTab(raw: string | null): 'normalized' | 'raw' {
  if (raw === 'raw') return 'raw';
  return 'normalized';
}

export default function SourceRecordPage() {
  const params = useParams<{ recordId: string }>();
  const searchParams = useSearchParams();

  const recordId = params.recordId;
  const tab = parseTab(searchParams.get('tab'));
  const assetUuidFromQuery = searchParams.get('assetUuid');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [normalized, setNormalized] = useState<NormalizedResponse | null>(null);
  const [raw, setRaw] = useState<RawResponse | null>(null);

  const backHref = useMemo(() => {
    if (assetUuidFromQuery) return `/assets/${encodeURIComponent(assetUuidFromQuery)}`;
    if (normalized?.meta?.assetUuid) return `/assets/${encodeURIComponent(normalized.meta.assetUuid)}`;
    return '/assets';
  }, [assetUuidFromQuery, normalized?.meta?.assetUuid]);

  const tabHref = (nextTab: 'normalized' | 'raw') => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set('tab', nextTab);
    return `/source-records/${encodeURIComponent(recordId)}?${qs.toString()}`;
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        if (tab === 'normalized') {
          setRaw(null);
          const result = await getSourceRecordNormalizedAction(recordId);
          if (!active) return;
          if (!result.ok) {
            setError(result.error ?? '加载失败');
            setNormalized(null);
            setLoading(false);
            return;
          }
          setNormalized(result.data ?? null);
          setLoading(false);
          return;
        }

        setNormalized(null);
        const result = await getSourceRecordRawAction(recordId);
        if (!active) return;
        if (!result.ok) {
          setError(result.error ?? '加载失败');
          setRaw(null);
          setLoading(false);
          return;
        }
        setRaw(result.data ?? null);
        setLoading(false);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setNormalized(null);
          setRaw(null);
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [recordId, tab]);

  const copy = async () => {
    const payload = tab === 'raw' ? raw?.rawPayload : normalized?.normalizedPayload;
    if (payload === undefined) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // ignore
    }
  };

  const payload = tab === 'raw' ? raw?.rawPayload : normalized?.normalizedPayload;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Source Record"
        meta={<IdText value={recordId} className="text-foreground" />}
        actions={
          <>
            <Button size="sm" variant="outline" disabled={loading || payload === undefined} onClick={copy}>
              复制 JSON
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={backHref}>返回</Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant={tab === 'normalized' ? 'secondary' : 'outline'}>
          <Link href={tabHref('normalized')}>Normalized</Link>
        </Button>
        <Button asChild size="sm" variant={tab === 'raw' ? 'secondary' : 'outline'}>
          <Link href={tabHref('raw')}>Raw</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tab === 'raw' ? 'Raw Payload' : 'Normalized Payload'}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">加载中…</div>
          ) : error ? (
            <div className="text-sm text-muted-foreground">{error}</div>
          ) : tab === 'raw' ? (
            !raw ? (
              <div className="text-sm text-muted-foreground">暂无数据。</div>
            ) : (
              <div className="space-y-3">
                <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <div>
                    recordId: <IdText value={recordId} className="text-foreground" />
                  </div>
                  <div>
                    sourceId: <IdText value={raw.meta.sourceId} className="text-foreground" />
                  </div>
                  <div>
                    runId: <IdText value={raw.meta.runId} className="text-foreground" />
                  </div>
                  <div>collectedAt: {raw.meta.collectedAt}</div>
                  <div>
                    hash: {raw.meta.hash} · sizeBytes: {raw.meta.sizeBytes} · compression: {raw.meta.compression}
                  </div>
                </div>

                <pre className="max-h-[70vh] overflow-auto rounded bg-muted p-3 text-xs">
                  {JSON.stringify(raw.rawPayload, null, 2)}
                </pre>
              </div>
            )
          ) : !normalized ? (
            <div className="text-sm text-muted-foreground">暂无数据。</div>
          ) : (
            <div className="space-y-3">
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                <div>
                  recordId: <IdText value={normalized.meta.recordId} className="text-foreground" />
                </div>
                <div>
                  assetUuid: <IdText value={normalized.meta.assetUuid} className="text-foreground" />
                </div>
                <div>
                  sourceId: <IdText value={normalized.meta.sourceId} className="text-foreground" />
                </div>
                <div>
                  runId: <IdText value={normalized.meta.runId} className="text-foreground" />
                </div>
                <div>collectedAt: {normalized.meta.collectedAt}</div>
                <div>
                  external: {normalized.meta.externalKind} · {normalized.meta.externalId}
                </div>
              </div>

              <pre className="max-h-[70vh] overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(normalized.normalizedPayload, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
