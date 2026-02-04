import Link from 'next/link';

import { prisma } from '@/lib/db/prisma';
import { parsePagination } from '@/lib/http/pagination';
import { getRunErrorUiMeta } from '@/lib/runs/run-error-actions';
import { getPrimaryRunIssue } from '@/lib/runs/run-issues';
import { compactId } from '@/lib/ui/compact-id';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RunMode, RunStatus, RunTriggerType } from '@prisma/client';

const SUPPORTED_STATUS = new Set<RunStatus>(['Queued', 'Running', 'Succeeded', 'Failed', 'Cancelled']);
const SUPPORTED_MODE = new Set<RunMode>(['collect', 'collect_hosts', 'collect_vms', 'detect', 'healthcheck']);
const SUPPORTED_TRIGGER = new Set<RunTriggerType>(['manual', 'schedule']);

type RunsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (typeof value === 'string') params.set(key, value);
  }

  const sourceId = params.get('sourceId') ?? '';
  const status = params.get('status') ?? '';
  const mode = params.get('mode') ?? '';
  const triggerType = params.get('triggerType') ?? '';

  const { skip, take } = parsePagination(params);

  const where = {
    ...(sourceId ? { sourceId } : {}),
    ...(status && SUPPORTED_STATUS.has(status as RunStatus) ? { status: status as RunStatus } : {}),
    ...(mode && SUPPORTED_MODE.has(mode as RunMode) ? { mode: mode as RunMode } : {}),
    ...(triggerType && SUPPORTED_TRIGGER.has(triggerType as RunTriggerType)
      ? { triggerType: triggerType as RunTriggerType }
      : {}),
  };

  const runs = await prisma.run.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip,
    take,
    include: { source: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="运行" description="采集/检测执行历史与排障入口。" />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <form className="grid gap-3 md:grid-cols-5" method="get">
            <div className="space-y-2">
              <Label htmlFor="sourceId">Source ID</Label>
              <Input id="sourceId" name="sourceId" defaultValue={sourceId} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">状态</Label>
              <NativeSelect id="status" name="status" defaultValue={status}>
                <option value="">全部</option>
                <option value="Queued">Queued</option>
                <option value="Running">Running</option>
                <option value="Succeeded">Succeeded</option>
                <option value="Failed">Failed</option>
                <option value="Cancelled">Cancelled</option>
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
              {runs.length === 0 ? '暂无数据' : `本页 ${runs.length} 条`}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {runs.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无采集记录。</div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>Run ID</TableHead>
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
                      <TableCell className="font-mono text-xs" title={run.id}>
                        {compactId(run.id)}
                      </TableCell>
                      <TableCell>{run.source?.name ?? run.sourceId}</TableCell>
                      <TableCell className="font-mono text-xs">{run.mode}</TableCell>
                      <TableCell className="font-mono text-xs">{run.triggerType}</TableCell>
                      <TableCell>{run.status}</TableCell>
                      <TableCell>
                        {run.status === 'Failed' && primaryIssue ? (
                          <div className="space-y-1">
                            <div className="font-mono text-xs">{primaryIssue.code}</div>
                            <div className="text-xs text-muted-foreground">{primaryMeta?.title ?? '-'}</div>
                            {primaryIssue.retryable ? (
                              <Badge variant="outline" className="w-fit">
                                可重试
                              </Badge>
                            ) : null}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
