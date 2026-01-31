'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { groupAssetFieldsForDisplay } from '@/lib/assets/asset-field-display';
import { formatAssetFieldValue } from '@/lib/assets/asset-field-value';
import { findMemberOfCluster, findRunsOnHost } from '@/lib/assets/asset-relation-chain';
import { flattenCanonicalFields } from '@/lib/assets/canonical-field';
import { RawDialog } from '@/components/raw/raw-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import type { AssetFieldFormatHint } from '@/lib/assets/asset-field-registry';

type AssetDetail = {
  assetUuid: string;
  assetType: string;
  status: string;
  mergedIntoAssetUuid: string | null;
  displayName: string | null;
  machineNameOverride?: string | null;
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

function formatAssetType(input: string) {
  if (input === 'vm') return 'VM';
  if (input === 'host') return 'Host';
  if (input === 'cluster') return 'Cluster';
  return input;
}

function powerStateLabel(powerState: string) {
  if (powerState === 'poweredOn') return '运行';
  if (powerState === 'poweredOff') return '关机';
  if (powerState === 'suspended') return '挂起';
  return powerState;
}

function pickLatestFieldValue(flattened: FlattenedField[], path: string): unknown {
  const found = flattened.find((f) => f.path === path);
  return found?.value ?? null;
}

function isComplexValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((v) => v !== null && typeof v === 'object');
  return typeof value === 'object';
}

function CanonicalValueCell({ value, formatHint }: { value: unknown; formatHint?: AssetFieldFormatHint }) {
  const text = formatAssetFieldValue(value, { formatHint });

  if (!isComplexValue(value)) return <span className="whitespace-normal break-words text-sm">{text}</span>;

  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-sm text-muted-foreground underline decoration-dotted underline-offset-2">
        {text}（展开）
      </summary>
      <pre className="mt-2 max-h-52 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export default function AssetDetailPage() {
  const router = useRouter();
  const params = useParams<{ uuid: string }>();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [sourceRecords, setSourceRecords] = useState<SourceRecordItem[]>([]);
  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedNormalized, setSelectedNormalized] = useState<{ recordId: string; payload: unknown } | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawRecordId, setRawRecordId] = useState<string | null>(null);

  const [chainHost, setChainHost] = useState<{
    assetUuid: string;
    assetType: string | null;
    displayName: string | null;
  } | null>(null);
  const [chainCluster, setChainCluster] = useState<{
    assetUuid: string;
    assetType: string | null;
    displayName: string | null;
  } | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

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
      const mergedIntoAssetUuid = assetBody.data?.mergedIntoAssetUuid ?? null;
      if (mergedIntoAssetUuid && assetBody.data?.status === 'merged' && mergedIntoAssetUuid !== uuid) {
        router.replace(`/assets/${encodeURIComponent(mergedIntoAssetUuid)}`);
        return;
      }
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
  }, [params.uuid, router]);

  useEffect(() => {
    if (asset?.assetType !== 'vm') {
      setChainHost(null);
      setChainCluster(null);
      setChainLoading(false);
      return;
    }

    const host = findRunsOnHost(relations);
    setChainHost(host);

    if (!host) {
      setChainCluster(null);
      setChainLoading(false);
      return;
    }

    setChainCluster(null);

    let active = true;
    const loadCluster = async () => {
      setChainLoading(true);
      try {
        const res = await fetch(`/api/v1/assets/${encodeURIComponent(host.assetUuid)}/relations`);
        if (!res.ok) {
          if (active) setChainCluster(null);
          return;
        }
        const body = (await res.json()) as { data?: RelationItem[] };
        if (active) setChainCluster(findMemberOfCluster(body.data ?? []));
      } finally {
        if (active) setChainLoading(false);
      }
    };

    void loadCluster();
    return () => {
      active = false;
    };
  }, [asset?.assetType, relations]);

  const canonicalFields = useMemo(() => {
    const canonical = asset?.latestSnapshot?.canonical as any;
    const fields = canonical?.fields as unknown;
    if (!fields) return [];
    return flattenCanonicalFields(fields);
  }, [asset?.latestSnapshot?.canonical]);

  const groupedFields = useMemo(() => groupAssetFieldsForDisplay(canonicalFields), [canonicalFields]);

  const summary = useMemo(() => {
    const assetType = asset?.assetType ?? '';
    const machineNameCollected = pickLatestFieldValue(canonicalFields, 'identity.hostname');
    const machineNameOverride = asset?.machineNameOverride ?? null;
    const machineName =
      typeof machineNameOverride === 'string' && machineNameOverride.trim().length > 0
        ? machineNameOverride.trim()
        : typeof machineNameCollected === 'string' && machineNameCollected.trim().length > 0
          ? machineNameCollected.trim()
          : null;

    const vmName = pickLatestFieldValue(canonicalFields, 'identity.caption');
    const osName = pickLatestFieldValue(canonicalFields, 'os.name');
    const osVersion = pickLatestFieldValue(canonicalFields, 'os.version');
    const ipAddresses = pickLatestFieldValue(canonicalFields, 'network.ip_addresses');
    const cpuCount = pickLatestFieldValue(canonicalFields, 'hardware.cpu_count');
    const memoryBytes = pickLatestFieldValue(canonicalFields, 'hardware.memory_bytes');
    const powerState = pickLatestFieldValue(canonicalFields, 'runtime.power_state');
    const toolsRunning = pickLatestFieldValue(canonicalFields, 'runtime.tools_running');

    const osText =
      typeof osName === 'string' && typeof osVersion === 'string'
        ? `${osName.trim()} ${osVersion.trim()}`.trim()
        : typeof osName === 'string'
          ? osName.trim()
          : typeof osVersion === 'string'
            ? osVersion.trim()
            : null;

    const ipText =
      Array.isArray(ipAddresses) && ipAddresses.every((v) => typeof v === 'string')
        ? ipAddresses
            .map((ip) => ip.trim())
            .filter((ip) => ip.length > 0)
            .join(', ')
        : null;

    const machineNameMismatch =
      typeof machineNameOverride === 'string' &&
      machineNameOverride.trim().length > 0 &&
      typeof machineNameCollected === 'string' &&
      machineNameCollected.trim().length > 0 &&
      machineNameOverride.trim() !== machineNameCollected.trim();

    return {
      assetType,
      machineName,
      machineNameOverride: typeof machineNameOverride === 'string' ? machineNameOverride.trim() : null,
      machineNameCollected: typeof machineNameCollected === 'string' ? machineNameCollected.trim() : null,
      machineNameMismatch,
      vmName: assetType === 'vm' ? (typeof vmName === 'string' ? vmName.trim() : null) : null,
      osText,
      ipText,
      cpuText: typeof cpuCount === 'number' ? String(cpuCount) : null,
      memoryText: typeof memoryBytes === 'number' ? formatAssetFieldValue(memoryBytes, { formatHint: 'bytes' }) : null,
      powerState: typeof powerState === 'string' ? powerState.trim() : null,
      toolsRunning: typeof toolsRunning === 'boolean' ? toolsRunning : null,
    };
  }, [asset?.assetType, asset?.machineNameOverride, canonicalFields]);

  const hostDatastores = useMemo(() => {
    if (asset?.assetType !== 'host') return null;
    const value = pickLatestFieldValue(canonicalFields, 'storage.datastores');
    if (!Array.isArray(value)) return null;
    return value
      .filter((v) => v && typeof v === 'object')
      .map((v) => v as Record<string, unknown>)
      .map((v) => ({
        name: typeof v.name === 'string' ? v.name.trim() : '',
        capacityBytes:
          typeof v.capacity_bytes === 'number' && Number.isFinite(v.capacity_bytes) ? v.capacity_bytes : NaN,
      }))
      .filter((v) => v.name.length > 0 && Number.isFinite(v.capacityBytes) && v.capacityBytes >= 0);
  }, [asset?.assetType, canonicalFields]);

  const hostDatastoreTotals = useMemo(() => {
    if (asset?.assetType !== 'host') return null;
    const total = pickLatestFieldValue(canonicalFields, 'attributes.datastore_total_bytes');
    const totalBytes = typeof total === 'number' && Number.isFinite(total) ? total : null;
    const sumBytes = (hostDatastores ?? []).reduce((acc, ds) => acc + ds.capacityBytes, 0);
    const hasList = hostDatastores !== null;
    const mismatch = totalBytes !== null && hasList && totalBytes !== sumBytes;
    return { totalBytes, sumBytes, hasList, mismatch };
  }, [asset?.assetType, canonicalFields, hostDatastores]);

  if (loading) return <div className="text-sm text-muted-foreground">加载中…</div>;
  if (!asset) return <div className="text-sm text-muted-foreground">未找到资产。</div>;

  const directCluster = asset.assetType === 'host' ? findMemberOfCluster(relations) : null;
  const datastoresTotals = hostDatastoreTotals ?? { totalBytes: null, sumBytes: 0, hasList: false, mismatch: false };

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
          <CardTitle>盘点摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{formatAssetType(asset.assetType)}</Badge>
            <Badge variant={asset.status === 'in_service' ? 'default' : 'secondary'}>{asset.status}</Badge>
            <span className="text-muted-foreground">Last Seen：</span>
            <span className="font-mono text-xs">{asset.lastSeenAt ?? '-'}</span>
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">Latest Snapshot</div>
            <div className="mt-1 font-mono text-xs">
              {asset.latestSnapshot ? `${asset.latestSnapshot.runId} · ${asset.latestSnapshot.createdAt}` : '暂无'}
            </div>
          </div>

          <Table>
            <TableBody>
              <TableRow>
                <TableHead>机器名</TableHead>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{summary.machineName ?? '-'}</span>
                    {summary.machineNameOverride ? (
                      summary.machineNameMismatch ? (
                        <Badge variant="destructive">覆盖≠采集</Badge>
                      ) : (
                        <Badge variant="secondary">覆盖</Badge>
                      )
                    ) : null}
                  </div>
                  {summary.machineNameOverride && summary.machineNameCollected ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      采集值：<span className="font-mono">{summary.machineNameCollected}</span>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
              {asset.assetType === 'vm' ? (
                <TableRow>
                  <TableHead>虚拟机名</TableHead>
                  <TableCell className="font-medium">{summary.vmName ?? asset.displayName ?? '-'}</TableCell>
                </TableRow>
              ) : null}
              <TableRow>
                <TableHead>操作系统</TableHead>
                <TableCell>{summary.osText ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>IP</TableHead>
                <TableCell className="font-mono text-xs">
                  {summary.ipText ? (
                    summary.ipText
                  ) : asset.assetType === 'vm' &&
                    summary.powerState === 'poweredOn' &&
                    summary.toolsRunning === false ? (
                    <span
                      className="cursor-help text-muted-foreground"
                      title="VMware Tools 未安装或未运行，无法获取 IP 地址"
                    >
                      - (Tools 未运行)
                    </span>
                  ) : (
                    '-'
                  )}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableHead>CPU</TableHead>
                <TableCell>{summary.cpuText ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>内存</TableHead>
                <TableCell>{summary.memoryText ?? '-'}</TableCell>
              </TableRow>
              {asset.assetType === 'vm' ? (
                <TableRow>
                  <TableHead>电源状态</TableHead>
                  <TableCell>
                    {summary.powerState ? <Badge variant="outline">{powerStateLabel(summary.powerState)}</Badge> : '-'}
                  </TableCell>
                </TableRow>
              ) : null}
              {asset.assetType === 'vm' ? (
                <TableRow>
                  <TableHead>Tools 运行</TableHead>
                  <TableCell>{summary.toolsRunning === null ? '-' : summary.toolsRunning ? '是' : '否'}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {asset.assetType === 'host' ? (
        <Card>
          <CardHeader>
            <CardTitle>Datastores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">总容量：</span>
              <span className="font-medium">
                {datastoresTotals.totalBytes === null
                  ? '-'
                  : formatAssetFieldValue(datastoresTotals.totalBytes, { formatHint: 'bytes' })}
              </span>
              <span className="text-muted-foreground">明细求和：</span>
              <span className="font-medium">
                {datastoresTotals.hasList
                  ? formatAssetFieldValue(datastoresTotals.sumBytes, { formatHint: 'bytes' })
                  : '-'}
              </span>
              {datastoresTotals.mismatch ? <Badge variant="destructive">不一致</Badge> : null}
            </div>

            {hostDatastores === null ? (
              <div className="text-sm text-muted-foreground">
                暂无 Datastore 明细（可能无权限/未采集到/采集异常）。建议查看该资产最近一次 Run 的 warnings/errors。
                {asset.latestSnapshot?.runId ? (
                  <>
                    {' '}
                    <Link href={`/runs/${encodeURIComponent(asset.latestSnapshot.runId)}`} className="underline">
                      打开 Run
                    </Link>
                    。
                  </>
                ) : null}
              </div>
            ) : hostDatastores.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Datastore 明细为空（该 Host 可能无 datastore，或已被过滤，或权限不足）。建议查看 Run 的
                warnings/errors。
                {asset.latestSnapshot?.runId ? (
                  <>
                    {' '}
                    <Link href={`/runs/${encodeURIComponent(asset.latestSnapshot.runId)}`} className="underline">
                      打开 Run
                    </Link>
                    。
                  </>
                ) : null}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead className="text-right">容量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hostDatastores.map((ds, idx) => (
                    <TableRow key={`${ds.name}:${idx}`}>
                      <TableCell className="font-mono text-xs">{ds.name}</TableCell>
                      <TableCell className="text-right text-sm">
                        {formatAssetFieldValue(ds.capacityBytes, { formatHint: 'bytes' })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>字段（结构化）</CardTitle>
        </CardHeader>
        <CardContent>
          {!asset.latestSnapshot ? (
            <div className="text-sm text-muted-foreground">暂无 canonical 快照。</div>
          ) : groupedFields.length === 0 ? (
            <div className="text-sm text-muted-foreground">canonical.fields 为空或不可解析。</div>
          ) : (
            <div className="space-y-4">
              {groupedFields.map((section) => (
                <div key={section.groupA} className="space-y-2">
                  <div className="text-sm font-semibold">{section.labelZh}</div>
                  {section.groups.map((g) => (
                    <div key={`${section.groupA}:${g.groupB}`} className="space-y-2 rounded-md border p-3">
                      <div className="text-xs font-medium text-muted-foreground">{g.labelZh}</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[220px]">字段 ID</TableHead>
                            <TableHead className="w-[160px]">字段名</TableHead>
                            <TableHead>值</TableHead>
                            <TableHead className="w-[80px] text-right">来源数</TableHead>
                            <TableHead className="w-[80px]">冲突</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.rows.map((row) => (
                            <TableRow key={`${section.groupA}:${g.groupB}:${row.path}`}>
                              <TableCell className="font-mono text-xs">{row.path}</TableCell>
                              <TableCell className="text-sm">{row.labelZh}</TableCell>
                              <TableCell>
                                <CanonicalValueCell value={row.value} formatHint={row.formatHint} />
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {row.sourcesCount}
                              </TableCell>
                              <TableCell>{row.conflict ? <Badge variant="destructive">冲突</Badge> : '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              ))}

              <details className="rounded-md border p-3">
                <summary className="cursor-pointer select-none text-sm font-medium">
                  调试：查看原始 canonical JSON
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
                  {JSON.stringify(asset.latestSnapshot.canonical, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>关系链</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-stretch gap-3">
            <div className="min-w-[220px] rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary">{formatAssetType(asset.assetType)}</Badge>
                <Badge variant={asset.status === 'in_service' ? 'default' : 'secondary'}>{asset.status}</Badge>
              </div>
              <div className="mt-2 text-sm font-medium">{asset.displayName ?? asset.assetUuid}</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">{asset.assetUuid}</div>
            </div>

            {asset.assetType === 'vm' ? (
              <>
                <div className="flex items-center text-muted-foreground">→</div>
                <div className="min-w-[220px] rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">Host</Badge>
                    {chainHost ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/assets/${chainHost.assetUuid}`}>查看</Link>
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-2 text-sm font-medium">{chainHost?.displayName ?? '-'}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{chainHost?.assetUuid ?? '-'}</div>
                </div>

                <div className="flex items-center text-muted-foreground">→</div>
                <div className="min-w-[220px] rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">Cluster</Badge>
                    {chainCluster ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/assets/${chainCluster.assetUuid}`}>查看</Link>
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-2 text-sm font-medium">
                    {chainLoading ? '加载中…' : (chainCluster?.displayName ?? '-')}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{chainCluster?.assetUuid ?? '-'}</div>
                </div>
              </>
            ) : asset.assetType === 'host' ? (
              <>
                <div className="flex items-center text-muted-foreground">→</div>
                <div className="min-w-[220px] rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">Cluster</Badge>
                    {directCluster ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/assets/${directCluster.assetUuid}`}>查看</Link>
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-2 text-sm font-medium">{directCluster?.displayName ?? '-'}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{directCluster?.assetUuid ?? '-'}</div>
                </div>
              </>
            ) : null}
          </div>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer select-none text-sm font-medium">调试：outgoing 关系表</summary>
            <div className="mt-3">
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
            </div>
          </details>
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
