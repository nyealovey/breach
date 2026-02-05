'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { groupAssetFieldsForDisplay } from '@/lib/assets/asset-field-display';
import { formatAssetFieldValue } from '@/lib/assets/asset-field-value';
import { formatIpAddressesForDisplay } from '@/lib/assets/ip-addresses';
import { normalizePowerState, powerStateLabelZh } from '@/lib/assets/power-state';
import { findMemberOfCluster, findRunsOnHost } from '@/lib/assets/asset-relation-chain';
import { flattenCanonicalFields } from '@/lib/assets/canonical-field';
import { isLedgerFieldAllowedForAssetType, listLedgerFieldMetasV1 } from '@/lib/ledger/ledger-fields-v1';

import type { AssetFieldRow } from '@/lib/assets/asset-field-display';
import type { AssetFieldFormatHint } from '@/lib/assets/asset-field-registry';
import type { LedgerFieldKey, LedgerFieldsV1 } from '@/lib/ledger/ledger-fields-v1';

type AssetDetail = {
  assetUuid: string;
  assetType: string;
  status: string;
  mergedIntoAssetUuid: string | null;
  displayName: string | null;
  machineNameOverride?: string | null;
  lastSeenAt: string | null;
  ledgerFields: LedgerFieldsV1;
  latestSnapshot: { runId: string; createdAt: string; canonical: unknown } | null;
};

type SourceRecordItem = {
  recordId: string;
  collectedAt: string;
  runId: string;
  sourceId: string;
  sourceName: string | null;
  externalKind: string;
  externalId: string;
  normalized: unknown;
};

type SourceChangeStatus = 'new' | 'changed' | 'same';

type SourceSummary = {
  sourceId: string;
  sourceName: string | null;
  latest: SourceRecordItem;
  previous: SourceRecordItem | null;
  status: SourceChangeStatus;
  recordsCount: number;
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

type AssetHistoryEventItem = {
  eventId: string;
  assetUuid: string;
  sourceAssetUuid: string | null;
  eventType: string;
  occurredAt: string;
  title: string;
  summary: unknown;
  refs: Record<string, unknown>;
};

type AssetHistoryResponse = {
  items: AssetHistoryEventItem[];
  nextCursor: string | null;
};

const LEDGER_FIELD_METAS = listLedgerFieldMetasV1();

const HISTORY_TYPE_OPTIONS: Array<{ type: string; label: string }> = [
  { type: 'collect.changed', label: '采集变化' },
  { type: 'ledger_fields.changed', label: '台账字段' },
  { type: 'asset.merged', label: '合并' },
  { type: 'asset.status_changed', label: '状态变化' },
];

type FlattenedField = {
  path: string;
  value: unknown;
  sourcesCount: number;
  conflict: boolean;
};

type StructuredFieldRow = AssetFieldRow & { groupTitle: string };

function formatAssetType(input: string) {
  if (input === 'vm') return 'VM';
  if (input === 'host') return 'Host';
  if (input === 'cluster') return 'Cluster';
  return input;
}

function powerStateLabel(powerState: string) {
  return powerStateLabelZh(powerState);
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

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort((a, b) => a.localeCompare(b, 'en'))) {
      out[key] = sortJson(obj[key]);
    }
    return out;
  }
  return value;
}

function stableStringifyJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(sortJson(value)) ?? 'undefined';
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
  const [showAllSources, setShowAllSources] = useState(false);
  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const isAdmin = role === 'admin';

  const [historyTypes, setHistoryTypes] = useState<string[]>([]);
  const [historyItems, setHistoryItems] = useState<AssetHistoryEventItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [ledgerEditing, setLedgerEditing] = useState(false);
  const [ledgerDraft, setLedgerDraft] = useState<Partial<Record<LedgerFieldKey, string>>>({});
  const [ledgerSaving, setLedgerSaving] = useState(false);

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
    const loadMe = async () => {
      const res = await fetch('/api/v1/auth/me');
      if (!res.ok) {
        if (active) setRole(null);
        return;
      }
      const body = (await res.json().catch(() => null)) as { data?: { role?: unknown } } | null;
      const rawRole = body?.data?.role;
      const nextRole = rawRole === 'admin' || rawRole === 'user' ? rawRole : null;
      if (active) setRole(nextRole);
    };
    void loadMe();
    return () => {
      active = false;
    };
  }, []);

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
          setLedgerEditing(false);
          setLedgerDraft({});
          setLedgerSaving(false);
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
        setLedgerEditing(false);
        setLedgerDraft({});
        setLedgerSaving(false);
        setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [params.uuid, router]);

  const loadHistoryPage = async (args: { cursor: string | null; replace: boolean }) => {
    if (historyLoading) return;
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const qs = new URLSearchParams();
      qs.set('limit', '20');
      if (args.cursor) qs.set('cursor', args.cursor);
      if (historyTypes.length > 0) qs.set('types', historyTypes.join(','));

      const res = await fetch(`/api/v1/assets/${encodeURIComponent(params.uuid)}/history?${qs.toString()}`);
      if (!res.ok) {
        setHistoryError(`加载失败（${res.status}）`);
        return;
      }

      const body = (await res.json().catch(() => null)) as { data?: AssetHistoryResponse } | null;
      const data = body?.data;
      const items = Array.isArray(data?.items) ? data!.items : [];
      const nextCursor = typeof data?.nextCursor === 'string' ? data.nextCursor : null;

      setHistoryItems((prev) => (args.replace ? items : [...prev, ...items]));
      setHistoryCursor(nextCursor);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    // Reload history when asset changes or filter changes.
    setHistoryItems([]);
    setHistoryCursor(null);
    setHistoryError(null);
    void loadHistoryPage({ cursor: null, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.uuid, historyTypes.join(',')]);

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
  const visibleGroupedFields = useMemo(() => {
    const assetType = asset?.assetType ?? null;

    const allowedGroupA =
      assetType === 'vm'
        ? new Set(['common', 'vm', 'attributes', 'unknown'])
        : assetType === 'host'
          ? new Set(['common', 'host', 'attributes', 'unknown'])
          : assetType === 'cluster'
            ? new Set(['common', 'cluster', 'attributes', 'unknown'])
            : null;

    return allowedGroupA ? groupedFields.filter((g) => allowedGroupA.has(g.groupA)) : groupedFields;
  }, [asset?.assetType, groupedFields]);

  const structuredRows = useMemo<StructuredFieldRow[]>(() => {
    const out: StructuredFieldRow[] = [];
    for (const section of visibleGroupedFields) {
      for (const g of section.groups) {
        const groupTitle = `${section.labelZh} / ${g.labelZh}`;
        for (const row of g.rows) out.push({ ...row, groupTitle });
      }
    }
    return out;
  }, [visibleGroupedFields]);

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

    const ipText = formatIpAddressesForDisplay(ipAddresses);

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

  const sourceSummaries = useMemo<SourceSummary[]>(() => {
    const bySourceId = new Map<string, SourceRecordItem[]>();
    for (const r of sourceRecords) {
      const bucket = bySourceId.get(r.sourceId);
      if (bucket) bucket.push(r);
      else bySourceId.set(r.sourceId, [r]);
    }

    const statusOrder = (status: SourceChangeStatus) => (status === 'changed' ? 0 : status === 'new' ? 1 : 2);

    const out: SourceSummary[] = [];
    for (const [sourceId, records] of bySourceId) {
      const sorted = records.slice().sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
      const latest = sorted[0];
      if (!latest) continue;
      const previous = sorted[1] ?? null;
      const status: SourceChangeStatus = !previous
        ? 'new'
        : stableStringifyJson(latest.normalized) === stableStringifyJson(previous.normalized)
          ? 'same'
          : 'changed';

      out.push({
        sourceId,
        sourceName: latest.sourceName ?? null,
        latest,
        previous,
        status,
        recordsCount: sorted.length,
      });
    }

    out.sort((a, b) => {
      const d = statusOrder(a.status) - statusOrder(b.status);
      if (d !== 0) return d;
      return b.latest.collectedAt.localeCompare(a.latest.collectedAt);
    });

    return out;
  }, [sourceRecords]);

  const visibleSourceSummaries = useMemo(() => {
    return showAllSources ? sourceSummaries : sourceSummaries.filter((s) => s.status !== 'same');
  }, [showAllSources, sourceSummaries]);

  if (loading) return <div className="text-sm text-muted-foreground">加载中…</div>;
  if (!asset) return <div className="text-sm text-muted-foreground">未找到资产。</div>;

  const directCluster = asset.assetType === 'host' ? findMemberOfCluster(relations) : null;
  const datastoresTotals = hostDatastoreTotals ?? { totalBytes: null, sumBytes: 0, hasList: false, mismatch: false };
  const allowedLedgerFieldMetas = LEDGER_FIELD_METAS.filter((meta) =>
    isLedgerFieldAllowedForAssetType(meta, asset.assetType as any),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={asset.displayName ?? <IdText value={asset.assetUuid} className="text-foreground" />}
        meta={<IdText value={asset.assetUuid} />}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/assets">返回列表</Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
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
                  {asset.latestSnapshot ? (
                    <>
                      <IdText value={asset.latestSnapshot.runId} className="text-foreground" /> ·{' '}
                      {asset.latestSnapshot.createdAt}
                    </>
                  ) : (
                    '暂无'
                  )}
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
                        normalizePowerState(summary.powerState ?? '') === 'poweredOn' &&
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
                  {asset.assetType === 'vm' || asset.assetType === 'host' ? (
                    <TableRow>
                      <TableHead>电源状态</TableHead>
                      <TableCell>
                        {summary.powerState ? (
                          <Badge variant="outline">{powerStateLabel(summary.powerState)}</Badge>
                        ) : (
                          '-'
                        )}
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

              {asset.assetType === 'host' ? (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer select-none text-sm font-medium">Datastores（可选）</summary>
                  <div className="mt-3 space-y-3">
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
                        暂无 Datastore 明细（可能无权限/未采集到/采集异常）。建议查看该资产最近一次 Run 的
                        warnings/errors。
                        {asset.latestSnapshot?.runId ? (
                          <>
                            {' '}
                            <Link
                              href={`/runs/${encodeURIComponent(asset.latestSnapshot.runId)}`}
                              className="underline"
                            >
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
                            <Link
                              href={`/runs/${encodeURIComponent(asset.latestSnapshot.runId)}`}
                              className="underline"
                            >
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
                  </div>
                </details>
              ) : null}
            </CardContent>
          </Card>

          {asset.assetType === 'vm' || asset.assetType === 'host' ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>台账字段</CardTitle>
                  {isAdmin ? (
                    ledgerEditing ? (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={ledgerSaving}
                          onClick={() => {
                            setLedgerEditing(false);
                            setLedgerDraft({});
                            setLedgerSaving(false);
                          }}
                        >
                          取消
                        </Button>
                        <Button
                          size="sm"
                          disabled={ledgerSaving}
                          onClick={async () => {
                            if (!asset) return;

                            const updates: Record<string, string | null> = {};
                            for (const meta of LEDGER_FIELD_METAS) {
                              if (!isLedgerFieldAllowedForAssetType(meta, asset.assetType as any)) continue;

                              const draft = (ledgerDraft[meta.key] ?? '').trim();
                              const nextValue = draft.length > 0 ? draft : null;
                              const prevValue = asset.ledgerFields?.[meta.key] ?? null;

                              if (nextValue !== prevValue) updates[meta.key] = nextValue;
                            }

                            if (Object.keys(updates).length < 1) {
                              toast('无变更');
                              setLedgerEditing(false);
                              return;
                            }

                            setLedgerSaving(true);
                            try {
                              const res = await fetch(
                                `/api/v1/assets/${encodeURIComponent(asset.assetUuid)}/ledger-fields`,
                                {
                                  method: 'PUT',
                                  headers: { 'content-type': 'application/json' },
                                  body: JSON.stringify({ ledgerFields: updates }),
                                },
                              );

                              if (!res.ok) {
                                const body = (await res.json().catch(() => null)) as {
                                  error?: { message?: string };
                                } | null;
                                toast.error(body?.error?.message ?? '保存失败');
                                return;
                              }

                              const body = (await res.json().catch(() => null)) as {
                                data?: { ledgerFields?: LedgerFieldsV1 };
                              } | null;
                              const nextLedgerFields = body?.data?.ledgerFields;
                              if (nextLedgerFields)
                                setAsset((prev) => (prev ? { ...prev, ledgerFields: nextLedgerFields } : prev));

                              toast.success('已保存');
                              setLedgerEditing(false);
                            } finally {
                              setLedgerSaving(false);
                            }
                          }}
                        >
                          保存
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const nextDraft: Partial<Record<LedgerFieldKey, string>> = {};
                          for (const meta of allowedLedgerFieldMetas) {
                            nextDraft[meta.key] = asset.ledgerFields?.[meta.key] ?? '';
                          }
                          setLedgerDraft(nextDraft);
                          setLedgerEditing(true);
                        }}
                      >
                        编辑
                      </Button>
                    )
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>字段</TableHead>
                      <TableHead>值</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allowedLedgerFieldMetas.map((meta) => {
                      const value = asset.ledgerFields?.[meta.key] ?? null;
                      const draft = ledgerDraft[meta.key] ?? value ?? '';

                      return (
                        <TableRow key={meta.key}>
                          <TableCell className="text-sm font-medium">
                            {meta.labelZh}
                            {meta.scope === 'host_only' ? (
                              <span className="ml-1 text-xs text-muted-foreground">(仅 Host)</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-sm">
                            {ledgerEditing && isAdmin ? (
                              meta.kind === 'date' ? (
                                <Input
                                  type="date"
                                  value={draft}
                                  onChange={(e) => setLedgerDraft((prev) => ({ ...prev, [meta.key]: e.target.value }))}
                                />
                              ) : (
                                <Input
                                  value={draft}
                                  placeholder="留空表示清空"
                                  onChange={(e) => setLedgerDraft((prev) => ({ ...prev, [meta.key]: e.target.value }))}
                                />
                              )
                            ) : value ? (
                              <span className="whitespace-normal break-words">{value}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>字段（结构化）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!asset.latestSnapshot ? (
                <div className="text-sm text-muted-foreground">暂无 canonical 快照。</div>
              ) : groupedFields.length === 0 ? (
                <div className="text-sm text-muted-foreground">canonical.fields 为空或不可解析。</div>
              ) : structuredRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">当前资产类型无可展示字段（已隐藏不相关字段）。</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[260px]">字段 ID</TableHead>
                        <TableHead>值</TableHead>
                        <TableHead className="w-[80px] text-right">来源数</TableHead>
                        <TableHead className="w-[80px]">冲突</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {structuredRows.map((row) => (
                        <TableRow key={row.path}>
                          <TableCell className="font-mono text-xs" title={row.groupTitle}>
                            {row.path}
                          </TableCell>
                          <TableCell>
                            <CanonicalValueCell value={row.value} formatHint={row.formatHint} />
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">{row.sourcesCount}</TableCell>
                          <TableCell>{row.conflict ? <Badge variant="destructive">冲突</Badge> : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>

          <details className="rounded-md border bg-background p-3">
            <summary className="cursor-pointer select-none text-sm font-medium">历史 / 时间线（可选）</summary>
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={historyTypes.length === 0 ? 'secondary' : 'outline'}
                  onClick={() => setHistoryTypes([])}
                >
                  全部
                </Button>
                {HISTORY_TYPE_OPTIONS.map((o) => {
                  const active = historyTypes.includes(o.type);
                  return (
                    <Button
                      key={o.type}
                      size="sm"
                      variant={active ? 'secondary' : 'outline'}
                      onClick={() => {
                        setHistoryTypes((prev) => {
                          if (prev.length === 0) return [o.type];
                          if (prev.includes(o.type)) {
                            const next = prev.filter((t) => t !== o.type);
                            return next.length === 0 ? [] : next;
                          }
                          return [...prev, o.type];
                        });
                      }}
                    >
                      {o.label}
                    </Button>
                  );
                })}
              </div>

              {historyLoading && historyItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">加载中…</div>
              ) : historyError ? (
                <div className="text-sm text-destructive">加载失败：{historyError}</div>
              ) : historyItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">暂无历史事件（可能尚未发生变化/尚无审计操作）。</div>
              ) : (
                <div className="space-y-3">
                  {historyItems.map((e) => {
                    const label = HISTORY_TYPE_OPTIONS.find((o) => o.type === e.eventType)?.label ?? e.eventType;
                    const summaryObj =
                      e.summary && typeof e.summary === 'object' ? (e.summary as Record<string, unknown>) : null;

                    const lines: string[] = [];
                    if (e.eventType === 'collect.changed') {
                      const changes = Array.isArray(summaryObj?.changes) ? (summaryObj?.changes as unknown[]) : [];
                      for (const c of changes.slice(0, 5)) {
                        if (!c || typeof c !== 'object') continue;
                        const obj = c as Record<string, unknown>;
                        const labelZh =
                          typeof obj.labelZh === 'string' ? obj.labelZh : typeof obj.path === 'string' ? obj.path : '-';
                        const before = typeof obj.before === 'string' ? obj.before : '';
                        const after = typeof obj.after === 'string' ? obj.after : '';
                        lines.push(`${labelZh}: ${before || '-'} -> ${after || '-'}`);
                      }
                      const relChanges = Array.isArray(summaryObj?.relationChanges)
                        ? (summaryObj?.relationChanges as unknown[])
                        : [];
                      for (const r of relChanges.slice(0, 3)) {
                        if (!r || typeof r !== 'object') continue;
                        const obj = r as Record<string, unknown>;
                        const type = typeof obj.type === 'string' ? obj.type : 'relation';
                        const before = typeof obj.before === 'string' ? obj.before : '';
                        const after = typeof obj.after === 'string' ? obj.after : '';
                        lines.push(`${type}: ${before || '-'} -> ${after || '-'}`);
                      }
                    } else if (e.eventType === 'asset.status_changed') {
                      const before = typeof summaryObj?.before === 'string' ? summaryObj.before : '';
                      const after = typeof summaryObj?.after === 'string' ? summaryObj.after : '';
                      lines.push(`${before || '-'} -> ${after || '-'}`);
                    } else if (e.eventType === 'asset.merged') {
                      const merged = Array.isArray(summaryObj?.mergedAssetUuids)
                        ? (summaryObj?.mergedAssetUuids as unknown[]).filter((v) => typeof v === 'string')
                        : [];
                      lines.push(`合并数量：${merged.length}`);
                    } else if (e.eventType === 'ledger_fields.changed') {
                      const actor =
                        summaryObj?.actor && typeof summaryObj.actor === 'object' ? (summaryObj.actor as any) : null;
                      const actorName = typeof actor?.username === 'string' ? actor.username : '-';
                      lines.push(`操作者：${actorName}`);
                      const changes = Array.isArray(summaryObj?.changes) ? (summaryObj?.changes as unknown[]) : [];
                      for (const c of changes.slice(0, 5)) {
                        if (!c || typeof c !== 'object') continue;
                        const obj = c as Record<string, unknown>;
                        const key = typeof obj.key === 'string' ? obj.key : '-';
                        const before = typeof obj.before === 'string' ? obj.before : '';
                        const after = typeof obj.after === 'string' ? obj.after : '';
                        lines.push(`${key}: ${before || '-'} -> ${after || '-'}`);
                      }
                      const key = typeof summaryObj?.key === 'string' ? summaryObj.key : '';
                      const valueSummary = typeof summaryObj?.valueSummary === 'string' ? summaryObj.valueSummary : '';
                      if (key) lines.push(`${key}: ${valueSummary || '-'}`);
                    }

                    const refs = e.refs && typeof e.refs === 'object' ? (e.refs as Record<string, unknown>) : {};
                    const runId = typeof refs.runId === 'string' ? refs.runId : null;

                    return (
                      <div key={e.eventId} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium">{e.title}</div>
                            <Badge variant="secondary">{label}</Badge>
                            {e.sourceAssetUuid ? (
                              <Badge variant="outline" title={e.sourceAssetUuid}>
                                来自合并资产
                              </Badge>
                            ) : null}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground">{e.occurredAt}</div>
                        </div>

                        {lines.length > 0 ? (
                          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                            {lines.slice(0, 6).map((t, idx) => (
                              <div key={`${e.eventId}:${idx}`}>{t}</div>
                            ))}
                          </div>
                        ) : null}

                        {runId ? (
                          <div className="mt-3">
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/runs/${runId}`}>查看 Run</Link>
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {historyCursor ? (
                <Button
                  variant="outline"
                  disabled={historyLoading}
                  onClick={() => void loadHistoryPage({ cursor: historyCursor, replace: false })}
                >
                  {historyLoading ? '加载中…' : '加载更多'}
                </Button>
              ) : null}
            </div>
          </details>
        </div>

        <div className="space-y-6">
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
                  <div className="mt-2 text-sm font-medium">
                    {asset.displayName ?? <IdText value={asset.assetUuid} className="text-foreground" />}
                  </div>
                  <div className="mt-1">
                    <IdText value={asset.assetUuid} />
                  </div>
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
                      <div
                        className="mt-1 font-mono text-xs text-muted-foreground"
                        title={chainHost?.assetUuid ?? undefined}
                      >
                        <IdText value={chainHost?.assetUuid ?? null} />
                      </div>
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
                      <div
                        className="mt-1 font-mono text-xs text-muted-foreground"
                        title={chainCluster?.assetUuid ?? undefined}
                      >
                        <IdText value={chainCluster?.assetUuid ?? null} />
                      </div>
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
                      <div
                        className="mt-1 font-mono text-xs text-muted-foreground"
                        title={directCluster?.assetUuid ?? undefined}
                      >
                        <IdText value={directCluster?.assetUuid ?? null} />
                      </div>
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
                              <div className="text-sm">
                                {r.toDisplayName ?? <IdText value={r.toAssetUuid} className="text-foreground" />}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {r.toAssetType ? `${formatAssetType(r.toAssetType)} · ` : null}
                                <IdText value={r.toAssetUuid} />
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
              <CardTitle>调试</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!asset.latestSnapshot ? (
                <div className="text-sm text-muted-foreground">暂无 canonical 快照。</div>
              ) : (
                <>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Latest Snapshot</div>
                    <div className="mt-1 space-y-1 text-xs">
                      <div>
                        runId: <IdText value={asset.latestSnapshot.runId} className="text-foreground" />
                      </div>
                      <div className="text-muted-foreground">createdAt: {asset.latestSnapshot.createdAt}</div>
                    </div>
                    <div className="mt-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/runs/${encodeURIComponent(asset.latestSnapshot.runId)}`}>打开 Run</Link>
                      </Button>
                    </div>
                  </div>

                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer select-none text-sm font-medium">
                      查看原始 canonical JSON
                    </summary>
                    <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
                      {JSON.stringify(asset.latestSnapshot.canonical, null, 2)}
                    </pre>
                  </details>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <CardTitle>来源明细</CardTitle>
                <div className="text-xs text-muted-foreground">
                  默认仅展示 <span className="font-mono">NEW/CHANGED</span>（按来源聚合，取最新一条记录与上一条对比）。
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={!showAllSources ? 'secondary' : 'outline'}
                  onClick={() => setShowAllSources(false)}
                >
                  仅变化
                </Button>
                <Button
                  size="sm"
                  variant={showAllSources ? 'secondary' : 'outline'}
                  onClick={() => setShowAllSources(true)}
                >
                  全部
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {sourceSummaries.length === 0 ? (
                <div className="text-sm text-muted-foreground">暂无来源明细。</div>
              ) : visibleSourceSummaries.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
                  <div className="text-sm text-muted-foreground">暂无变化来源（全部来源均为 SAME）。</div>
                  <Button size="sm" variant="outline" onClick={() => setShowAllSources(true)}>
                    显示全部
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>来源</TableHead>
                      <TableHead className="w-[120px]">状态</TableHead>
                      <TableHead>Collected At</TableHead>
                      <TableHead>External</TableHead>
                      <TableHead>Run</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleSourceSummaries.map((s) => {
                      const tag = s.status === 'changed' ? 'CHANGED' : s.status === 'new' ? 'NEW' : 'SAME';
                      const variant = s.status === 'changed' ? 'default' : s.status === 'new' ? 'secondary' : 'outline';
                      return (
                        <TableRow key={s.sourceId}>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="text-sm font-medium">{s.sourceName ?? '-'}</div>
                              <IdText value={s.sourceId} />
                              <div className="text-xs text-muted-foreground">历史 {s.recordsCount} 条</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={variant}>{tag}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{s.latest.collectedAt}</TableCell>
                          <TableCell>
                            <div className="text-sm">{s.latest.externalId}</div>
                            <div className="text-xs text-muted-foreground">{s.latest.externalKind}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <IdText value={s.latest.runId} />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button asChild size="sm" variant="outline">
                                <Link
                                  href={`/source-records/${encodeURIComponent(s.latest.recordId)}?tab=normalized&assetUuid=${encodeURIComponent(asset.assetUuid)}`}
                                >
                                  查看 normalized
                                </Link>
                              </Button>
                              {isAdmin ? (
                                <Button asChild size="sm" variant="outline">
                                  <Link
                                    href={`/source-records/${encodeURIComponent(s.latest.recordId)}?tab=raw&assetUuid=${encodeURIComponent(asset.assetUuid)}`}
                                  >
                                    查看 raw
                                  </Link>
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
