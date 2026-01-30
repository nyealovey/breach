import Link from 'next/link';

import { prisma } from '@/lib/db/prisma';
import { parsePagination } from '@/lib/http/pagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <Card>
      <CardHeader>
        <CardTitle>运行</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="grid gap-3 md:grid-cols-5" method="get">
          <div className="space-y-2">
            <Label htmlFor="sourceId">Source ID</Label>
            <Input id="sourceId" name="sourceId" defaultValue={sourceId} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">状态</Label>
            <select
              id="status"
              name="status"
              className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
              defaultValue={status}
            >
              <option value="">全部</option>
              <option value="Queued">Queued</option>
              <option value="Running">Running</option>
              <option value="Succeeded">Succeeded</option>
              <option value="Failed">Failed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mode">模式</Label>
            <select
              id="mode"
              name="mode"
              className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
              defaultValue={mode}
            >
              <option value="">全部</option>
              <option value="collect">collect</option>
              <option value="collect_hosts">collect_hosts</option>
              <option value="collect_vms">collect_vms</option>
              <option value="healthcheck">healthcheck</option>
              <option value="detect">detect</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="triggerType">触发方式</Label>
            <select
              id="triggerType"
              name="triggerType"
              className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
              defaultValue={triggerType}
            >
              <option value="">全部</option>
              <option value="manual">manual</option>
              <option value="schedule">schedule</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="outline" className="w-full">
              应用过滤
            </Button>
          </div>
        </form>

        {runs.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无采集记录。</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>模式</TableHead>
                <TableHead>触发方式</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>结束时间</TableHead>
                <TableHead>错误/警告</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const warningsCount = Array.isArray(run.warnings) ? run.warnings.length : 0;
                const errorsCount = Array.isArray(run.errors) ? run.errors.length : 0;
                return (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.id}</TableCell>
                    <TableCell>{run.source?.name ?? run.sourceId}</TableCell>
                    <TableCell>{run.mode}</TableCell>
                    <TableCell>{run.triggerType}</TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell>{run.finishedAt?.toISOString() ?? '-'}</TableCell>
                    <TableCell>
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
  );
}
