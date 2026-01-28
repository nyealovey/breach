'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { RawDialog } from '@/components/raw/raw-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type AssetDetail = {
  assetUuid: string;
  assetType: string;
  status: string;
  displayName: string | null;
  lastSeenAt: string | null;
  latestSnapshot: { runId: string; createdAt: string; canonical: unknown } | null;
};

type SourceRecordItem = {
  recordId: string;
  collectedAt: string;
  runId: string;
  sourceId: string;
  externalKind: string;
  externalId: string;
  normalized: unknown;
};

type RelationItem = {
  relationId: string;
  relationType: string;
  toAssetUuid: string;
  toAssetType: string | null;
  toDisplayName: string | null;
  sourceId: string;
  lastSeenAt: string;
};

type FlattenedField = {
  path: string;
  value: unknown;
  sourcesCount: number;
  conflict: boolean;
};

function isFieldValue(node: unknown): node is { value: unknown; sources: unknown[]; conflict?: boolean } {
  if (!node || typeof node !== 'object') return false;
  if (!('value' in node) || !('sources' in node)) return false;
  return Array.isArray((node as any).sources);
}

function flattenCanonical(node: unknown, prefix: string[] = []): FlattenedField[] {
  if (isFieldValue(node)) {
    return [
      {
        path: prefix.join('.'),
        value: node.value,
        sourcesCount: node.sources.length,
        conflict: node.conflict === true,
      },
    ];
  }

  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const out: FlattenedField[] = [];
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out.push(...flattenCanonical(v, [...prefix, k]));
    }
    return out;
  }

  // Unexpected scalar, keep it visible.
  return [{ path: prefix.join('.'), value: node, sourcesCount: 0, conflict: false }];
}

function formatAssetType(input: string) {
  if (input === 'vm') return 'VM';
  if (input === 'host') return 'Host';
  if (input === 'cluster') return 'Cluster';
  return input;
}

export default function AssetDetailPage() {
  const params = useParams<{ uuid: string }>();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [sourceRecords, setSourceRecords] = useState<SourceRecordItem[]>([]);
  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedNormalized, setSelectedNormalized] = useState<{ recordId: string; payload: unknown } | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawRecordId, setRawRecordId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);

      const uuid = params.uuid;
      const [assetRes, recordsRes, relationsRes] = await Promise.all([
        fetch(`/api/v1/assets/${uuid}`),
        fetch(`/api/v1/assets/${uuid}/source-records`),
        fetch(`/api/v1/assets/${uuid}/relations`),
      ]);

      if (!assetRes.ok) {
        if (active) {
          setAsset(null);
          setSourceRecords([]);
          setRelations([]);
          setSelectedNormalized(null);
          setRawOpen(false);
          setRawRecordId(null);
          setLoading(false);
        }
        return;
      }

      const assetBody = (await assetRes.json()) as { data: AssetDetail };
      const recordsBody = recordsRes.ok ? ((await recordsRes.json()) as { data: SourceRecordItem[] }) : null;
      const relationsBody = relationsRes.ok ? ((await relationsRes.json()) as { data: RelationItem[] }) : null;

      if (active) {
        setAsset(assetBody.data ?? null);
        setSourceRecords(recordsBody?.data ?? []);
        setRelations(relationsBody?.data ?? []);
        setSelectedNormalized(null);
        setRawOpen(false);
        setRawRecordId(null);
        setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [params.uuid]);

  const canonicalFields = useMemo(() => {
    const canonical = asset?.latestSnapshot?.canonical as any;
    const fields = canonical?.fields as unknown;
    if (!fields) return [];
    return flattenCanonical(fields);
  }, [asset?.latestSnapshot?.canonical]);

  if (loading) return <div className="text-sm text-muted-foreground">加载中…</div>;
  if (!asset) return <div className="text-sm text-muted-foreground">未找到资产。</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">{asset.displayName ?? asset.assetUuid}</div>
          <div className="text-xs text-muted-foreground">{asset.assetUuid}</div>
        </div>
        <Button asChild variant="outline">
          <Link href="/assets">返回列表</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow>
                <TableHead>类型</TableHead>
                <TableCell>{formatAssetType(asset.assetType)}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>状态</TableHead>
                <TableCell>
                  <Badge variant={asset.status === 'in_service' ? 'default' : 'secondary'}>{asset.status}</Badge>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableHead>Last Seen</TableHead>
                <TableCell>{asset.lastSeenAt ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>Latest Snapshot</TableHead>
                <TableCell>
                  {asset.latestSnapshot ? `${asset.latestSnapshot.runId} · ${asset.latestSnapshot.createdAt}` : '暂无'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Canonical（fields）</CardTitle>
        </CardHeader>
        <CardContent>
          {!asset.latestSnapshot ? (
            <div className="text-sm text-muted-foreground">暂无 canonical 快照。</div>
          ) : canonicalFields.length === 0 ? (
            <div className="text-sm text-muted-foreground">canonical.fields 为空或不可解析。</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>字段</TableHead>
                  <TableHead>值</TableHead>
                  <TableHead>来源数</TableHead>
                  <TableHead>冲突</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {canonicalFields.map((row) => (
                  <TableRow key={row.path}>
                    <TableCell className="font-mono text-xs">{row.path}</TableCell>
                    <TableCell className="max-w-[480px]">
                      <pre className="max-h-28 overflow-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(row.value, null, 2)}
                      </pre>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.sourcesCount}</TableCell>
                    <TableCell>{row.conflict ? <Badge variant="destructive">冲突</Badge> : '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>关系（outgoing）</CardTitle>
        </CardHeader>
        <CardContent>
          {relations.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无 outgoing 关系。</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead>目标</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {relations.map((r) => (
                  <TableRow key={r.relationId}>
                    <TableCell>{r.relationType}</TableCell>
                    <TableCell>
                      <div className="text-sm">{r.toDisplayName ?? r.toAssetUuid}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.toAssetType ? `${formatAssetType(r.toAssetType)} · ` : null}
                        {r.toAssetUuid}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.lastSeenAt}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/assets/${r.toAssetUuid}`}>查看</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>来源明细（normalized）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sourceRecords.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无来源明细。</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Collected At</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>External</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourceRecords.map((r) => (
                  <TableRow key={`${r.recordId}_${r.collectedAt}`}>
                    <TableCell className="text-xs text-muted-foreground">{r.collectedAt}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.sourceId}</TableCell>
                    <TableCell>
                      <div className="text-sm">{r.externalId}</div>
                      <div className="text-xs text-muted-foreground">{r.externalKind}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.runId}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedNormalized({ recordId: r.recordId, payload: r.normalized })}
                        >
                          查看 normalized
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRawRecordId(r.recordId);
                            setRawOpen(true);
                          }}
                        >
                          查看 raw
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {selectedNormalized ? (
            <div>
              <div className="text-sm font-medium">normalized · {selectedNormalized.recordId}</div>
              <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(selectedNormalized.payload, null, 2)}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <RawDialog
        recordId={rawRecordId}
        open={rawOpen}
        onOpenChange={(open) => {
          setRawOpen(open);
          if (!open) setRawRecordId(null);
        }}
      />
    </div>
  );
}
