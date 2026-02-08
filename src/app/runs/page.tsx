import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireServerSession } from '@/lib/auth/require-server-session';
import { prisma } from '@/lib/db/prisma';
import { buildPagination, parsePagination } from '@/lib/http/pagination';
import { getRunErrorUiMeta } from '@/lib/runs/run-error-actions';
import { getPrimaryRunIssue } from '@/lib/runs/run-issues';
import { RunMode, RunStatus, RunTriggerType } from '@prisma/client';

const FILTERABLE_STATUS = new Set<RunStatus>(['Succeeded', 'Failed']);
const SUPPORTED_MODE = new Set<RunMode>(['collect', 'collect_hosts', 'collect_vms', 'detect', 'healthcheck']);
const SUPPORTED_TRIGGER = new Set<RunTriggerType>(['manual', 'schedule']);

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

type RunsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RunsPage({ searchParams }: RunsPageProps) {
  await requireServerSession();

  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (typeof value === 'string') params.set(key, value);
  }

  const scheduleGroupId = params.get('scheduleGroupId') ?? '';
  const status = params.get('status') ?? '';
  const mode = params.get('mode') ?? '';
  const triggerType = params.get('triggerType') ?? '';

  const { page, pageSize, skip, take } = parsePagination(params);

  const where = {
    ...(scheduleGroupId ? { scheduleGroupId } : {}),
    ...(status && FILTERABLE_STATUS.has(status as RunStatus) ? { status: status as RunStatus } : {}),
    ...(mode && SUPPORTED_MODE.has(mode as RunMode) ? { mode: mode as RunMode } : {}),
    ...(triggerType && SUPPORTED_TRIGGER.has(triggerType as RunTriggerType)
      ? { triggerType: triggerType as RunTriggerType }
      : {}),
  };

  const [total, runs, scheduleGroups] = await prisma.$transaction([
    prisma.run.count({ where }),
    prisma.run.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        source: { select: { name: true } },
        scheduleGroup: { select: { name: true } },
      },
    }),
    prisma.scheduleGroup.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, enabled: true } }),
  ]);

  const pagination = buildPagination(total, page, pageSize);
  const canPrev = pagination.page > 1;
  const canNext = pagination.page < pagination.totalPages;

  const buildHref = (next: Record<string, string | null>) => {
    const qs = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v) qs.delete(k);
      else qs.set(k, v);
    }
    const s = qs.toString();
    return `/runs${s ? `?${s}` : ''}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="运行" description="采集/检测执行历史与排障入口。" />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <form className="grid gap-3 md:grid-cols-5" method="get">
            <input type="hidden" name="pageSize" value={String(pageSize)} />

            <div className="space-y-2">
              <Label htmlFor="scheduleGroupId">调度组</Label>
              <NativeSelect id="scheduleGroupId" name="scheduleGroupId" defaultValue={scheduleGroupId}>
                <option value="">全部</option>
                {scheduleGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.enabled ? '' : '（已停用）'}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">结果</Label>
              <NativeSelect id="status" name="status" defaultValue={status}>
                <option value="">全部</option>
                <option value="Succeeded">成功</option>
                <option value="Failed">失败</option>
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mode">模式</Label>
              <NativeSelect id="mode" name="mode" defaultValue={mode}>
                <option value="">全部</option>
                <option value="collect">collect</option>
                <option value="collect_hosts">collect_hosts</option>
                <option value="collect_vms">collect_vms</option>
                <option value="healthcheck">healthcheck</option>
                <option value="detect">detect</option>
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor="triggerType">触发方式</Label>
              <NativeSelect id="triggerType" name="triggerType" defaultValue={triggerType}>
                <option value="">全部</option>
                <option value="manual">manual</option>
                <option value="schedule">schedule</option>
              </NativeSelect>
            </div>

            <div className="flex items-end">
              <Button type="submit" variant="outline" className="w-full">
                应用过滤
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">列表</div>
            <div className="text-xs text-muted-foreground">
              {total === 0
                ? '暂无数据'
                : `第 ${pagination.page} / ${pagination.totalPages} 页 · 共 ${pagination.total} 条`}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {runs.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无采集记录。</div>
          ) : (
            <>
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>调度组</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>模式</TableHead>
                    <TableHead>触发方式</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>主错误</TableHead>
                    <TableHead>结束时间</TableHead>
                    <TableHead>错误/警告</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const warningsCount = Array.isArray(run.warnings) ? run.warnings.length : 0;
                    const errorsCount = Array.isArray(run.errors) ? run.errors.length : 0;
                    const primaryIssue = getPrimaryRunIssue({
                      status: run.status,
                      errors: run.errors,
                      errorSummary: run.errorSummary,
                    });
                    const primaryMeta = primaryIssue ? getRunErrorUiMeta(primaryIssue.code) : null;
                    return (
                      <TableRow key={run.id}>
                        <TableCell>
                          <IdText value={run.id} className="text-foreground" />
                        </TableCell>
                        <TableCell className="text-sm">{run.scheduleGroup?.name ?? '-'}</TableCell>
                        <TableCell className="text-sm">{run.source?.name ?? run.sourceId}</TableCell>
                        <TableCell className="font-mono text-xs">{run.mode}</TableCell>
                        <TableCell className="font-mono text-xs">{run.triggerType}</TableCell>
                        <TableCell>{run.status}</TableCell>
                        <TableCell>
                          {run.status === 'Failed' && primaryIssue ? (
                            <div className="space-y-1">
                              <div className="font-mono text-xs">{primaryIssue.code}</div>
                              <div className="text-xs text-muted-foreground">{primaryMeta?.title ?? '-'}</div>
                            </div>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{run.finishedAt?.toISOString() ?? '-'}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {errorsCount}/{warningsCount}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/runs/${run.id}`}>详情</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs text-muted-foreground">每页</div>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <Button key={size} asChild size="sm" variant={pageSize === size ? 'secondary' : 'outline'}>
                      <Link href={buildHref({ page: '1', pageSize: String(size) })}>{size} / 页</Link>
                    </Button>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2">
                  {canPrev ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={buildHref({ page: String(Math.max(1, page - 1)) })}>上一页</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled>
                      上一页
                    </Button>
                  )}
                  {canNext ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={buildHref({ page: String(page + 1) })}>下一页</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled>
                      下一页
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
