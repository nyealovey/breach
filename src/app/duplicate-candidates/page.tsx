'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { RequireAdminClient } from '@/components/auth/require-admin-client';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  buildDuplicateCandidatesUrlSearchParams,
  parseDuplicateCandidatesUrlState,
} from '@/lib/duplicate-candidates/duplicate-candidates-url';
import {
  candidateStatusLabel,
  confidenceBadgeVariant,
  confidenceLabel,
} from '@/lib/duplicate-candidates/duplicate-candidates-ui';

import type {
  DuplicateCandidateAssetTypeParam,
  DuplicateCandidateConfidenceParam,
  DuplicateCandidateStatusParam,
  DuplicateCandidatesUrlState,
} from '@/lib/duplicate-candidates/duplicate-candidates-url';

type DuplicateCandidateListItem = {
  candidateId: string;
  status: DuplicateCandidateStatusParam;
  score: number;
  confidence: DuplicateCandidateConfidenceParam;
  lastObservedAt: string;
  assetA: {
    assetUuid: string;
    assetType: DuplicateCandidateAssetTypeParam;
    status: string;
    displayName: string | null;
    lastSeenAt: string | null;
  };
  assetB: {
    assetUuid: string;
    assetType: DuplicateCandidateAssetTypeParam;
    status: string;
    displayName: string | null;
    lastSeenAt: string | null;
  };
};

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export default function DuplicateCandidatesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<DuplicateCandidateListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);

  const urlState = useMemo(() => {
    return parseDuplicateCandidatesUrlState(new URLSearchParams(searchParams.toString()));
  }, [searchParams]);

  const replaceUrlState = (nextState: DuplicateCandidatesUrlState) => {
    const nextParams = buildDuplicateCandidatesUrlSearchParams(nextState);
    const next = nextParams.toString();
    router.replace(`${pathname}${next ? `?${next}` : ''}`, { scroll: false });
  };

  const statusInput = urlState.status;
  const assetTypeInput: 'all' | DuplicateCandidateAssetTypeParam = urlState.assetType ?? 'all';
  const confidenceInput: 'all' | DuplicateCandidateConfidenceParam = urlState.confidence ?? 'all';
  const page = urlState.page;
  const pageSize = urlState.pageSize;

  useEffect(() => {
    // Normalize URL: remove default params and clamp invalid values.
    const current = searchParams.toString();
    const next = buildDuplicateCandidatesUrlSearchParams(urlState).toString();
    if (next === current) return;
    router.replace(`${pathname}${next ? `?${next}` : ''}`, { scroll: false });
  }, [pathname, router, searchParams, urlState]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);

      const params = buildDuplicateCandidatesUrlSearchParams(urlState);
      const res = await fetch(`/api/v1/duplicate-candidates?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? '加载失败');

        if (active) {
          setItems([]);
          setPagination(null);
          setLoading(false);
        }
        return;
      }

      const body = (await res.json()) as { data: DuplicateCandidateListItem[]; pagination: Pagination };
      if (active) {
        setItems(body.data ?? []);
        setPagination(body.pagination ?? null);
        setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [urlState]);

  const canPrev = (pagination?.page ?? 1) > 1;
  const canNext = (pagination?.page ?? 1) < (pagination?.totalPages ?? 1);

  return (
    <>
      <RequireAdminClient />
      <div className="space-y-6">
        <PageHeader title="重复中心" description="detect 生成的重复候选（按状态/类型/置信度筛选）。" />

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end">
              <Select
                value={statusInput}
                onValueChange={(value) => {
                  replaceUrlState({ ...urlState, status: value as DuplicateCandidateStatusParam, page: 1 });
                }}
              >
                <SelectTrigger className="w-full md:w-[150px]">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">待处理</SelectItem>
                  <SelectItem value="ignored">已忽略</SelectItem>
                  <SelectItem value="merged">已合并</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={assetTypeInput}
                onValueChange={(value) => {
                  const assetType = value === 'all' ? undefined : (value as DuplicateCandidateAssetTypeParam);
                  replaceUrlState({ ...urlState, assetType, page: 1 });
                }}
              >
                <SelectTrigger className="w-full md:w-[150px]">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  <SelectItem value="vm">VM</SelectItem>
                  <SelectItem value="host">Host</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={confidenceInput}
                onValueChange={(value) => {
                  const confidence = value === 'all' ? undefined : (value as DuplicateCandidateConfidenceParam);
                  replaceUrlState({ ...urlState, confidence, page: 1 });
                }}
              >
                <SelectTrigger className="w-full md:w-[160px]">
                  <SelectValue placeholder="置信度" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部置信度</SelectItem>
                  <SelectItem value="High">High (&gt;=90)</SelectItem>
                  <SelectItem value="Medium">Medium (70-89)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium">列表</div>
              <div className="text-xs text-muted-foreground">
                {loading
                  ? '加载中…'
                  : pagination
                    ? `第 ${pagination.page} / ${pagination.totalPages} 页 · 共 ${pagination.total} 条`
                    : items.length === 0
                      ? '暂无数据'
                      : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">加载中…</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                暂无候选。请先完成一次 detect Run（或等待 worker 生成 duplicate candidates）。
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>置信度</TableHead>
                      <TableHead>资产 A</TableHead>
                      <TableHead>资产 B</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>最后观测</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const confidence = item.confidence ?? confidenceLabel(item.score);
                      return (
                        <TableRow
                          key={item.candidateId}
                          className="cursor-pointer"
                          onClick={() => router.push(`/duplicate-candidates/${item.candidateId}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant={confidenceBadgeVariant(confidence)}>{confidence}</Badge>
                              <span className="text-xs text-muted-foreground">{item.score}</span>
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="space-y-1">
                              <div className="font-medium">{item.assetA.displayName ?? '-'}</div>
                              <IdText value={item.assetA.assetUuid} />
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="space-y-1">
                              <div className="font-medium">{item.assetB.displayName ?? '-'}</div>
                              <IdText value={item.assetB.assetUuid} />
                            </div>
                          </TableCell>

                          <TableCell className="text-sm">{candidateStatusLabel(item.status)}</TableCell>

                          <TableCell className="font-mono text-xs">{item.lastObservedAt}</TableCell>

                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/duplicate-candidates/${item.candidateId}`);
                              }}
                            >
                              查看
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground">每页</div>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(value) => {
                        replaceUrlState({ ...urlState, page: 1, pageSize: Number(value) });
                      }}
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="每页" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 / 页</SelectItem>
                        <SelectItem value="20">20 / 页</SelectItem>
                        <SelectItem value="50">50 / 页</SelectItem>
                        <SelectItem value="100">100 / 页</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canPrev}
                      onClick={() => replaceUrlState({ ...urlState, page: Math.max(1, page - 1) })}
                    >
                      上一页
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canNext}
                      onClick={() => replaceUrlState({ ...urlState, page: page + 1 })}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
