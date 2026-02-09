'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IdText } from '@/components/ui/id-text';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatAssetFieldValue } from '@/lib/assets/asset-field-value';
import { compareCandidateFieldValues, extractCandidateReasons } from '@/lib/duplicate-candidates/candidate-ui-utils';
import {
  candidateStatusLabel,
  confidenceBadgeVariant,
  confidenceLabel,
} from '@/lib/duplicate-candidates/duplicate-candidates-ui';

import type { CandidateReason } from '@/lib/duplicate-candidates/candidate-ui-utils';
import type {
  DuplicateCandidateDetail,
  DuplicateCandidatePageInitialData,
  DuplicateCandidateSourceLink,
} from '@/lib/duplicate-candidates/page-data';

type ApiBody<T> = {
  data?: T;
  error?: { message?: string };
};

function getCanonicalFieldValue(fields: unknown, path: string): unknown {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const parts = path.split('.').filter(Boolean);
  let cur: any = fields;
  for (const key of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = cur[key];
  }

  if (cur && typeof cur === 'object' && !Array.isArray(cur) && 'value' in cur) return (cur as any).value;
  return cur;
}

function presenceStatusLabel(status: DuplicateCandidateSourceLink['presenceStatus']) {
  if (status === 'present') return '存在';
  return '缺失';
}

function presenceStatusBadgeVariant(
  status: DuplicateCandidateSourceLink['presenceStatus'],
): React.ComponentProps<typeof Badge>['variant'] {
  if (status === 'present') return 'secondary';
  return 'destructive';
}

export default function DuplicateCandidateDetailPage({
  initialData,
}: {
  initialData: DuplicateCandidatePageInitialData;
}) {
  const router = useRouter();
  const candidateId = initialData.candidateId;

  const [data, setData] = useState<DuplicateCandidateDetail | null>(initialData.candidate);
  const loadError = initialData.loadError;
  const canonicalLoading = false;
  const canonicalFieldsA = initialData.canonicalFields.assetA;
  const canonicalFieldsB = initialData.canonicalFields.assetB;
  const canonicalError = initialData.canonicalFields.error;
  const vmHostA = initialData.vmHosts.assetA;
  const vmHostB = initialData.vmHosts.assetB;
  const vmHostLoading = false;

  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState('');
  const [ignoreSaving, setIgnoreSaving] = useState(false);

  const reasons = useMemo(() => {
    if (!data) return [];
    return extractCandidateReasons(data.reasons);
  }, [data]);

  const reasonByCode = useMemo(() => {
    const map = new Map<string, CandidateReason>();
    for (const r of reasons) map.set(r.code, r);
    return map;
  }, [reasons]);

  const compareRows = useMemo(() => {
    if (!data) return [];

    const fromCanonical = (path: string) => ({
      a: getCanonicalFieldValue(canonicalFieldsA, path),
      b: getCanonicalFieldValue(canonicalFieldsB, path),
      source: canonicalFieldsA || canonicalFieldsB ? 'canonical' : 'missing',
    });

    const assetType = data.assetA.assetType;

    if (assetType === 'vm') {
      const machineUuidEvidence = reasonByCode.get('vm.machine_uuid_match')?.evidence;
      const macEvidence = reasonByCode.get('vm.mac_overlap')?.evidence;
      const hostnameIpEvidence = reasonByCode.get('vm.hostname_ip_overlap')?.evidence as
        | { a?: { hostname?: unknown; ips?: unknown }; b?: { hostname?: unknown; ips?: unknown } }
        | undefined;

      return [
        {
          key: 'runs_on_host',
          label: 'runs_on_host',
          a: vmHostA?.displayName ?? vmHostA?.assetUuid,
          b: vmHostB?.displayName ?? vmHostB?.assetUuid,
          source: vmHostA || vmHostB ? 'relation' : 'missing',
        },
        {
          key: 'machine_uuid',
          label: 'machine_uuid',
          ...(machineUuidEvidence && 'a' in machineUuidEvidence && 'b' in machineUuidEvidence
            ? { a: machineUuidEvidence.a, b: machineUuidEvidence.b, source: 'evidence' as const }
            : fromCanonical('identity.machine_uuid')),
        },
        {
          key: 'hostname',
          label: 'hostname',
          ...(hostnameIpEvidence?.a || hostnameIpEvidence?.b
            ? { a: hostnameIpEvidence?.a?.hostname, b: hostnameIpEvidence?.b?.hostname, source: 'evidence' as const }
            : fromCanonical('identity.hostname')),
        },
        {
          key: 'ip_addresses',
          label: 'ip_addresses',
          ...(hostnameIpEvidence?.a || hostnameIpEvidence?.b
            ? { a: hostnameIpEvidence?.a?.ips, b: hostnameIpEvidence?.b?.ips, source: 'evidence' as const }
            : fromCanonical('network.ip_addresses')),
        },
        {
          key: 'mac_addresses',
          label: 'mac_addresses',
          ...(macEvidence && 'a' in macEvidence && 'b' in macEvidence
            ? { a: macEvidence.a, b: macEvidence.b, source: 'evidence' as const }
            : fromCanonical('network.mac_addresses')),
        },
        {
          key: 'os.fingerprint',
          label: 'os.fingerprint',
          ...fromCanonical('os.fingerprint'),
        },
      ];
    }

    const serialEvidence = reasonByCode.get('host.serial_match')?.evidence;
    const bmcEvidence = reasonByCode.get('host.bmc_ip_match')?.evidence;
    const mgmtEvidence = reasonByCode.get('host.mgmt_ip_match')?.evidence;

    return [
      {
        key: 'serial_number',
        label: 'serial_number',
        ...(serialEvidence && 'a' in serialEvidence && 'b' in serialEvidence
          ? { a: serialEvidence.a, b: serialEvidence.b, source: 'evidence' as const }
          : fromCanonical('identity.serial_number')),
      },
      {
        key: 'bmc_ip',
        label: 'bmc_ip',
        ...(bmcEvidence && 'a' in bmcEvidence && 'b' in bmcEvidence
          ? { a: bmcEvidence.a, b: bmcEvidence.b, source: 'evidence' as const }
          : fromCanonical('network.bmc_ip')),
      },
      {
        key: 'management_ip',
        label: 'management_ip',
        ...(mgmtEvidence && 'a' in mgmtEvidence && 'b' in mgmtEvidence
          ? { a: mgmtEvidence.a, b: mgmtEvidence.b, source: 'evidence' as const }
          : fromCanonical('network.management_ip')),
      },
      {
        key: 'hostname',
        label: 'hostname',
        ...fromCanonical('identity.hostname'),
      },
      {
        key: 'os.fingerprint',
        label: 'os.fingerprint',
        ...fromCanonical('os.fingerprint'),
      },
    ];
  }, [canonicalFieldsA, canonicalFieldsB, data, reasonByCode, vmHostA, vmHostB]);

  const ignoreDisabled = !data || data.status !== 'open';

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title="候选详情"
          meta={<IdText value={candidateId} className="text-foreground" />}
          actions={
            <>
              <Button asChild size="sm" variant="outline">
                <Link href="/duplicate-candidates">返回列表</Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.push(`/duplicate-candidates/${encodeURIComponent(candidateId)}/merge`)}
                disabled={!data}
              >
                进入 Merge
              </Button>
              <Button size="sm" variant="destructive" disabled={ignoreDisabled} onClick={() => setIgnoreOpen(true)}>
                Ignore
              </Button>
            </>
          }
        />

        {loadError ? (
          <div className="text-sm text-muted-foreground">{loadError}</div>
        ) : !data ? (
          <div className="text-sm text-muted-foreground">候选不存在或无权限访问。</div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>候选详情</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={confidenceBadgeVariant(data.confidence ?? confidenceLabel(data.score))}>
                    {data.confidence ?? confidenceLabel(data.score)} · {data.score}
                  </Badge>
                  <Badge variant="outline">{candidateStatusLabel(data.status)}</Badge>
                  <span className="text-xs text-muted-foreground">lastObservedAt: {data.lastObservedAt}</span>
                  <span className="text-xs text-muted-foreground">createdAt: {data.createdAt}</span>
                  <span className="text-xs text-muted-foreground">updatedAt: {data.updatedAt}</span>
                </div>

                {data.ignore ? (
                  <div className="rounded-md border bg-muted/30 p-3 text-xs">
                    <div className="text-muted-foreground">已忽略</div>
                    <div className="mt-1 grid gap-1">
                      <div>
                        ignoredAt: <span className="font-mono">{data.ignore.ignoredAt ?? '-'}</span>
                      </div>
                      <div>
                        ignoreReason: <span className="font-mono">{data.ignore.ignoreReason ?? '-'}</span>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2">
                  <Card className="border-dashed">
                    <CardHeader>
                      <CardTitle className="text-base">资产 A</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{data.assetA.assetType}</Badge>
                        <Badge variant={data.assetA.status === 'in_service' ? 'default' : 'secondary'}>
                          {data.assetA.status}
                        </Badge>
                      </div>
                      <div className="text-sm font-medium">{data.assetA.displayName ?? '-'}</div>
                      {data.assetA.assetType === 'vm' ? (
                        <div className="text-xs text-muted-foreground">
                          宿主机:{' '}
                          {vmHostLoading ? (
                            '加载中…'
                          ) : vmHostA ? (
                            <Link
                              href={`/assets/${encodeURIComponent(vmHostA.assetUuid)}`}
                              className="underline underline-offset-2"
                            >
                              {vmHostA.displayName ?? vmHostA.assetUuid}
                            </Link>
                          ) : (
                            '-'
                          )}
                        </div>
                      ) : null}
                      <IdText value={data.assetA.assetUuid} />
                      <div className="text-xs text-muted-foreground">lastSeenAt: {data.assetA.lastSeenAt ?? '-'}</div>
                      <div>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/assets/${encodeURIComponent(data.assetA.assetUuid)}`}>打开资产</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-dashed">
                    <CardHeader>
                      <CardTitle className="text-base">资产 B</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{data.assetB.assetType}</Badge>
                        <Badge variant={data.assetB.status === 'in_service' ? 'default' : 'secondary'}>
                          {data.assetB.status}
                        </Badge>
                      </div>
                      <div className="text-sm font-medium">{data.assetB.displayName ?? '-'}</div>
                      {data.assetB.assetType === 'vm' ? (
                        <div className="text-xs text-muted-foreground">
                          宿主机:{' '}
                          {vmHostLoading ? (
                            '加载中…'
                          ) : vmHostB ? (
                            <Link
                              href={`/assets/${encodeURIComponent(vmHostB.assetUuid)}`}
                              className="underline underline-offset-2"
                            >
                              {vmHostB.displayName ?? vmHostB.assetUuid}
                            </Link>
                          ) : (
                            '-'
                          )}
                        </div>
                      ) : null}
                      <IdText value={data.assetB.assetUuid} />
                      <div className="text-xs text-muted-foreground">lastSeenAt: {data.assetB.lastSeenAt ?? '-'}</div>
                      <div>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/assets/${encodeURIComponent(data.assetB.assetUuid)}`}>打开资产</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>关键字段对比</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {canonicalLoading ? <div className="text-sm text-muted-foreground">加载 canonical 快照中…</div> : null}
                {canonicalError ? <div className="text-sm text-muted-foreground">{canonicalError}</div> : null}
                {!canonicalLoading && !canonicalError && !canonicalFieldsA && !canonicalFieldsB ? (
                  <div className="text-sm text-muted-foreground">未能加载 canonical.fields（将仅展示 evidence）。</div>
                ) : null}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[220px]">字段</TableHead>
                      <TableHead>资产 A</TableHead>
                      <TableHead>资产 B</TableHead>
                      <TableHead className="w-[120px]">对比</TableHead>
                      <TableHead className="w-[100px]">来源</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compareRows.map((row) => {
                      const compare = compareCandidateFieldValues(row.a, row.b);
                      const label = compare === 'match' ? '一致' : compare === 'missing' ? '缺失' : '不一致';
                      const variant =
                        compare === 'match' ? 'secondary' : compare === 'missing' ? 'outline' : 'destructive';
                      return (
                        <TableRow key={row.key} className={compare === 'mismatch' ? 'bg-destructive/5' : ''}>
                          <TableCell className="font-mono text-xs">{row.label}</TableCell>
                          <TableCell className="max-w-[440px] whitespace-normal break-words text-sm">
                            {formatAssetFieldValue(row.a)}
                          </TableCell>
                          <TableCell className="max-w-[440px] whitespace-normal break-words text-sm">
                            {formatAssetFieldValue(row.b)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={variant}>{label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{row.source}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>命中原因（dup-rules-v1）</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {reasons.length === 0 ? (
                  <div className="text-sm text-muted-foreground">暂无命中原因（reasons 为空）。</div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {reasons.map((r) => (
                      <div key={r.code} className="rounded-md border bg-muted/20 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono text-xs">{r.code}</div>
                          <Badge variant="outline">weight: {r.weight}</Badge>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          evidence.field: {r.evidence?.field ?? '-'}
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <div className="rounded border bg-background p-2">
                            <div className="mb-1 text-[11px] text-muted-foreground">A</div>
                            <pre className="max-h-40 overflow-auto text-xs">
                              {JSON.stringify(r.evidence?.a ?? null, null, 2)}
                            </pre>
                          </div>
                          <div className="rounded border bg-background p-2">
                            <div className="mb-1 text-[11px] text-muted-foreground">B</div>
                            <pre className="max-h-40 overflow-auto text-xs">
                              {JSON.stringify(r.evidence?.b ?? null, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer select-none text-sm font-medium">
                    调试：查看 reasons 原始 JSON
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(data.reasons, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>

            <div className="grid gap-3 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>来源链接（资产 A）</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.assetA.sourceLinks.length === 0 ? (
                    <div className="text-sm text-muted-foreground">暂无 sourceLinks。</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>来源</TableHead>
                          <TableHead>external</TableHead>
                          <TableHead>presence</TableHead>
                          <TableHead>lastSeenAt</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.assetA.sourceLinks.map((l) => (
                          <TableRow key={`${l.sourceId}:${l.externalKind}:${l.externalId}`}>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="text-sm">{l.sourceName}</div>
                                <IdText value={l.sourceId} />
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {l.externalKind}:{l.externalId}
                            </TableCell>
                            <TableCell>
                              <Badge variant={presenceStatusBadgeVariant(l.presenceStatus)}>
                                {presenceStatusLabel(l.presenceStatus)}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              <div>{l.lastSeenAt}</div>
                              {l.lastSeenRunId ? (
                                <div className="text-muted-foreground">
                                  run: <IdText value={l.lastSeenRunId} className="text-muted-foreground" />
                                </div>
                              ) : null}
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
                  <CardTitle>来源链接（资产 B）</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.assetB.sourceLinks.length === 0 ? (
                    <div className="text-sm text-muted-foreground">暂无 sourceLinks。</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>来源</TableHead>
                          <TableHead>external</TableHead>
                          <TableHead>presence</TableHead>
                          <TableHead>lastSeenAt</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.assetB.sourceLinks.map((l) => (
                          <TableRow key={`${l.sourceId}:${l.externalKind}:${l.externalId}`}>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="text-sm">{l.sourceName}</div>
                                <IdText value={l.sourceId} />
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {l.externalKind}:{l.externalId}
                            </TableCell>
                            <TableCell>
                              <Badge variant={presenceStatusBadgeVariant(l.presenceStatus)}>
                                {presenceStatusLabel(l.presenceStatus)}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              <div>{l.lastSeenAt}</div>
                              {l.lastSeenRunId ? (
                                <div className="text-muted-foreground">
                                  run: <IdText value={l.lastSeenRunId} className="text-muted-foreground" />
                                </div>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        <Dialog
          open={ignoreOpen}
          onOpenChange={(open) => {
            setIgnoreOpen(open);
            if (!open) {
              setIgnoreReason('');
              setIgnoreSaving(false);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ignore 候选</DialogTitle>
              <DialogDescription>Ignore 是终态操作（永久）。可填写原因（可空）。</DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="ignoreReason">原因</Label>
              <Textarea
                id="ignoreReason"
                value={ignoreReason}
                placeholder="例如：同一台机器多 Source 重复入库；或误报原因…"
                onChange={(e) => setIgnoreReason(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" disabled={ignoreSaving} onClick={() => setIgnoreOpen(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={ignoreSaving || !data || data.status !== 'open'}
                onClick={async () => {
                  if (!data) return;
                  if (data.status !== 'open') return;
                  setIgnoreSaving(true);

                  try {
                    const reason = ignoreReason.trim() ? ignoreReason.trim() : undefined;
                    const res = await fetch(
                      `/api/v1/duplicate-candidates/${encodeURIComponent(data.candidateId)}/ignore`,
                      {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(reason ? { reason } : {}),
                      },
                    );
                    const body = (await res.json().catch(() => null)) as ApiBody<{
                      candidateId: string;
                      status: string;
                      ignoredAt: string | null;
                      ignoreReason: string | null;
                    }> | null;
                    if (!res.ok) {
                      toast.error(body?.error?.message ?? 'Ignore 失败');
                      return;
                    }

                    toast.success('已忽略');
                    setData((prev) =>
                      prev
                        ? {
                            ...prev,
                            status: 'ignored',
                            updatedAt: new Date().toISOString(),
                            ignore: {
                              ignoredByUserId: prev.ignore?.ignoredByUserId ?? null,
                              ignoredAt: body?.data?.ignoredAt ?? new Date().toISOString(),
                              ignoreReason: body?.data?.ignoreReason ?? reason ?? null,
                            },
                          }
                        : prev,
                    );
                    setIgnoreOpen(false);
                  } catch {
                    toast.error('Ignore 失败');
                  } finally {
                    setIgnoreSaving(false);
                  }
                }}
              >
                确认 Ignore
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
