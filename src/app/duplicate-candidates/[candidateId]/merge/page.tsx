'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { findRunsOnHost } from '@/lib/assets/asset-relation-chain';
import { formatAssetFieldValue } from '@/lib/assets/asset-field-value';
import { compareCandidateFieldValues, extractCandidateReasons } from '@/lib/duplicate-candidates/candidate-ui-utils';
import {
  candidateStatusLabel,
  confidenceBadgeVariant,
  confidenceLabel,
} from '@/lib/duplicate-candidates/duplicate-candidates-ui';

import type { RelationChainNode, RelationRef } from '@/lib/assets/asset-relation-chain';
import type { CandidateReason } from '@/lib/duplicate-candidates/candidate-ui-utils';

type CandidateAsset = {
  assetUuid: string;
  assetType: 'vm' | 'host';
  status: string;
  displayName: string | null;
  lastSeenAt: string | null;
};

type CandidateDetail = {
  candidateId: string;
  status: 'open' | 'ignored' | 'merged';
  score: number;
  confidence: 'High' | 'Medium';
  reasons: CandidateReason[] | unknown;
  lastObservedAt: string;
  assetA: CandidateAsset;
  assetB: CandidateAsset;
};

type AssetApiDetail = {
  assetUuid: string;
  latestSnapshot: null | { canonical: unknown; createdAt: string; runId: string };
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

export default function DuplicateCandidateMergePage() {
  const router = useRouter();
  const params = useParams<{ candidateId: string }>();
  const candidateId = params.candidateId;

  const [data, setData] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [canonicalLoading, setCanonicalLoading] = useState(false);
  const [canonicalFieldsA, setCanonicalFieldsA] = useState<unknown | null>(null);
  const [canonicalFieldsB, setCanonicalFieldsB] = useState<unknown | null>(null);

  const [vmHostA, setVmHostA] = useState<RelationChainNode | null>(null);
  const [vmHostB, setVmHostB] = useState<RelationChainNode | null>(null);
  const [vmHostLoading, setVmHostLoading] = useState(false);

  const [primarySide, setPrimarySide] = useState<'A' | 'B'>('A');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setData(null);

      try {
        const res = await fetch(`/api/v1/duplicate-candidates/${encodeURIComponent(candidateId)}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          toast.error(body?.error?.message ?? '加载失败');
          if (active) setLoading(false);
          return;
        }

        const body = (await res.json()) as { data: CandidateDetail };
        const candidate = body.data ?? null;
        if (!active) return;

        setData(candidate);
        setLoading(false);

        // Pick a default primary:
        // - VM: prefer in_service as primary when the other is offline.
        // - Otherwise: keep assetA as primary by default.
        if (candidate?.assetA?.assetType === 'vm') {
          const aOk = candidate.assetA.status === 'in_service' && candidate.assetB.status === 'offline';
          const bOk = candidate.assetB.status === 'in_service' && candidate.assetA.status === 'offline';
          if (aOk) setPrimarySide('A');
          else if (bOk) setPrimarySide('B');
          else setPrimarySide('A');
        } else {
          setPrimarySide('A');
        }
      } catch {
        toast.error('网络错误，加载失败');
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [candidateId]);

  useEffect(() => {
    let active = true;
    const loadVmHosts = async () => {
      if (!data) return;
      if (data.assetA.assetType !== 'vm' || data.assetB.assetType !== 'vm') return;

      setVmHostLoading(true);
      setVmHostA(null);
      setVmHostB(null);

      try {
        const [aRes, bRes] = await Promise.all([
          fetch(`/api/v1/assets/${encodeURIComponent(data.assetA.assetUuid)}/relations`),
          fetch(`/api/v1/assets/${encodeURIComponent(data.assetB.assetUuid)}/relations`),
        ]);

        const parse = async (res: Response): Promise<RelationRef[]> => {
          if (!res.ok) return [];
          const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
          return Array.isArray(body?.data) ? (body.data as RelationRef[]) : [];
        };

        const [aRels, bRels] = await Promise.all([parse(aRes), parse(bRes)]);
        const hostA = findRunsOnHost(aRels);
        const hostB = findRunsOnHost(bRels);

        if (active) {
          setVmHostA(hostA);
          setVmHostB(hostB);
          setVmHostLoading(false);
        }
      } catch {
        if (active) setVmHostLoading(false);
      }
    };

    void loadVmHosts();
    return () => {
      active = false;
    };
  }, [data]);

  useEffect(() => {
    let active = true;
    const loadCanonical = async () => {
      if (!data) return;

      setCanonicalLoading(true);
      setCanonicalFieldsA(null);
      setCanonicalFieldsB(null);

      try {
        const [aRes, bRes] = await Promise.all([
          fetch(`/api/v1/assets/${encodeURIComponent(data.assetA.assetUuid)}`),
          fetch(`/api/v1/assets/${encodeURIComponent(data.assetB.assetUuid)}`),
        ]);

        const loadOne = async (res: Response): Promise<unknown | null> => {
          if (!res.ok) return null;
          const body = (await res.json().catch(() => null)) as { data?: AssetApiDetail } | null;
          const canonical = body?.data?.latestSnapshot?.canonical;
          if (!canonical || typeof canonical !== 'object') return null;
          const fields = (canonical as any).fields;
          return fields ?? null;
        };

        const [fieldsA, fieldsB] = await Promise.all([loadOne(aRes), loadOne(bRes)]);
        if (active) {
          setCanonicalFieldsA(fieldsA);
          setCanonicalFieldsB(fieldsB);
          setCanonicalLoading(false);
        }
      } catch {
        if (active) setCanonicalLoading(false);
      }
    };

    void loadCanonical();
    return () => {
      active = false;
    };
  }, [data]);

  const reasons = useMemo(() => {
    if (!data) return [];
    return extractCandidateReasons(data.reasons);
  }, [data]);

  const compareRows = useMemo(() => {
    if (!data) return [];

    const fromCanonical = (path: string) => ({
      key: path,
      label: path,
      a: getCanonicalFieldValue(canonicalFieldsA, path),
      b: getCanonicalFieldValue(canonicalFieldsB, path),
      source: canonicalFieldsA || canonicalFieldsB ? ('canonical' as const) : ('missing' as const),
    });

    const assetType = data.assetA.assetType;
    if (assetType === 'vm') {
      return [
        {
          key: 'runs_on_host',
          label: 'runs_on_host',
          a: vmHostA?.displayName ?? vmHostA?.assetUuid,
          b: vmHostB?.displayName ?? vmHostB?.assetUuid,
          source: vmHostA || vmHostB ? ('relation' as const) : ('missing' as const),
        },
        fromCanonical('identity.machine_uuid'),
        fromCanonical('identity.hostname'),
        fromCanonical('network.ip_addresses'),
        fromCanonical('network.mac_addresses'),
        fromCanonical('os.fingerprint'),
      ];
    }

    if (assetType === 'host') {
      return [
        fromCanonical('identity.serial_number'),
        fromCanonical('network.bmc_ip'),
        fromCanonical('network.management_ip'),
        fromCanonical('identity.hostname'),
        fromCanonical('os.fingerprint'),
      ];
    }

    return [];
  }, [canonicalFieldsA, canonicalFieldsB, data, vmHostA, vmHostB]);

  const primary = data ? (primarySide === 'A' ? data.assetA : data.assetB) : null;
  const secondary = data ? (primarySide === 'A' ? data.assetB : data.assetA) : null;

  const vmGate = useMemo(() => {
    if (!primary || !secondary) return { ok: false, message: '缺少资产信息' };
    if (primary.assetType !== 'vm') return { ok: true, message: '' };

    const ok = primary.status === 'in_service' && secondary.status === 'offline';
    return ok
      ? { ok: true, message: '' }
      : { ok: false, message: 'VM 合并门槛未满足：仅允许将 offline VM 合并到 in_service VM（仅关机不等于下线）。' };
  }, [primary, secondary]);

  const mergeDisabled = loading || !data || data.status !== 'open' || !primary || !secondary || !vmGate.ok || merging;

  return (
    <>
      <RequireAdminClient />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push(`/duplicate-candidates/${encodeURIComponent(candidateId)}`)}
          >
            返回候选
          </Button>
          <div className="font-mono text-xs text-muted-foreground">{candidateId}</div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">加载中…</div>
        ) : !data ? (
          <div className="text-sm text-muted-foreground">候选不存在或无权限访问。</div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>合并确认</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={confidenceBadgeVariant(data.confidence ?? confidenceLabel(data.score))}>
                    {data.confidence ?? confidenceLabel(data.score)} · {data.score}
                  </Badge>
                  <Badge variant="outline">{candidateStatusLabel(data.status)}</Badge>
                  <span className="text-xs text-muted-foreground">lastObservedAt: {data.lastObservedAt}</span>
                </div>

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
                      <div className="font-mono text-xs text-muted-foreground">{data.assetA.assetUuid}</div>
                      <div className="text-xs text-muted-foreground">lastSeenAt: {data.assetA.lastSeenAt ?? '-'}</div>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/assets/${encodeURIComponent(data.assetA.assetUuid)}`}>打开资产</Link>
                      </Button>
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
                      <div className="font-mono text-xs text-muted-foreground">{data.assetB.assetUuid}</div>
                      <div className="text-xs text-muted-foreground">lastSeenAt: {data.assetB.lastSeenAt ?? '-'}</div>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/assets/${encodeURIComponent(data.assetB.assetUuid)}`}>打开资产</Link>
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <div className="space-y-2">
                      <Label>选择主资产（primary_wins）</Label>
                      <Select value={primarySide} onValueChange={(v) => setPrimarySide(v as 'A' | 'B')}>
                        <SelectTrigger className="max-w-[520px]">
                          <SelectValue placeholder="选择主资产" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A">
                            A：{data.assetA.displayName ?? data.assetA.assetUuid}（{data.assetA.status}）
                          </SelectItem>
                          <SelectItem value="B">
                            B：{data.assetB.displayName ?? data.assetB.assetUuid}（{data.assetB.status}）
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="text-xs text-muted-foreground">
                        策略固定为 <span className="font-mono">primary_wins</span>：冲突字段以主资产为准。
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border bg-muted/20 p-3 text-xs">
                    <div className="font-medium">本次合并</div>
                    <div className="mt-2 space-y-1">
                      <div>
                        primary: <span className="font-mono">{primary?.assetUuid ?? '-'}</span>
                      </div>
                      <div>
                        merge: <span className="font-mono">{secondary?.assetUuid ?? '-'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {!vmGate.ok ? (
                  <div className="rounded-md border bg-destructive/5 p-3 text-sm">{vmGate.message}</div>
                ) : null}

                <div className="flex items-center gap-2">
                  <Button
                    disabled={mergeDisabled}
                    variant="destructive"
                    onClick={() => {
                      setConfirmOpen(true);
                    }}
                  >
                    发起合并
                  </Button>
                  <Button
                    disabled={!data || !primary}
                    variant="outline"
                    onClick={() => router.push(`/assets/${encodeURIComponent(primary?.assetUuid ?? '')}`)}
                  >
                    打开主资产
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>关键字段对比（主资产将被保留）</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {canonicalLoading ? <div className="text-sm text-muted-foreground">加载 canonical 快照中…</div> : null}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[240px]">字段</TableHead>
                      <TableHead>资产 A</TableHead>
                      <TableHead>资产 B</TableHead>
                      <TableHead className="w-[120px]">对比</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compareRows.map((row) => {
                      const compare = compareCandidateFieldValues(row.a, row.b);
                      const label = compare === 'match' ? '一致' : compare === 'missing' ? '缺失' : '冲突';
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
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>命中原因（参考）</CardTitle>
              </CardHeader>
              <CardContent>
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
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Dialog
          open={confirmOpen}
          onOpenChange={(open) => {
            setConfirmOpen(open);
            if (!open) setMerging(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认合并</DialogTitle>
              <DialogDescription>
                本操作不可撤销（当前版本不支持 unmerge）。冲突策略固定为 <span className="font-mono">primary_wins</span>
                。
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              <div>
                primary: <span className="font-mono">{primary?.assetUuid ?? '-'}</span>
              </div>
              <div>
                merge: <span className="font-mono">{secondary?.assetUuid ?? '-'}</span>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" disabled={merging} onClick={() => setConfirmOpen(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={mergeDisabled}
                onClick={async () => {
                  if (!primary || !secondary) return;
                  setMerging(true);

                  const res = await fetch(`/api/v1/assets/${encodeURIComponent(primary.assetUuid)}/merge`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ mergedAssetUuids: [secondary.assetUuid], conflictStrategy: 'primary_wins' }),
                  });

                  if (!res.ok) {
                    const body = (await res.json().catch(() => null)) as {
                      error?: { code?: string; message?: string };
                    } | null;

                    if (body?.error?.code === 'CONFIG_ASSET_MERGE_VM_REQUIRES_OFFLINE') {
                      toast.error('VM 合并门槛未满足：仅关机不等于下线（需 offline 才可合并）。');
                    } else {
                      toast.error(body?.error?.message ?? '合并失败');
                    }

                    setMerging(false);
                    return;
                  }

                  toast.success('合并成功');
                  setConfirmOpen(false);
                  router.replace(`/assets/${encodeURIComponent(primary.assetUuid)}`);
                }}
              >
                确认合并
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
