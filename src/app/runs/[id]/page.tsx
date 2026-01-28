'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';

type RunDetail = {
  runId: string;
  sourceId: string;
  sourceName: string | null;
  mode: string;
  triggerType: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  detectResult: unknown;
  stats: unknown;
  warnings: unknown[];
  errors: unknown[];
};

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const res = await fetch(`/api/v1/runs/${params.id}`);
      if (!res.ok) {
        setRun(null);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as { data: RunDetail };
      if (active) {
        setRun(body.data);
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [params.id]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  if (!run) {
    return <div className="text-sm text-muted-foreground">未找到 Run。</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Run 详情</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableCell>{run.runId}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>来源</TableHead>
                <TableCell>{run.sourceName ?? run.sourceId}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>模式</TableHead>
                <TableCell>{run.mode}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>触发方式</TableHead>
                <TableCell>{run.triggerType}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>状态</TableHead>
                <TableCell>{run.status}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>开始时间</TableHead>
                <TableCell>{run.startedAt ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>结束时间</TableHead>
                <TableCell>{run.finishedAt ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>耗时</TableHead>
                <TableCell>{run.durationMs} ms</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>统计与检测</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-medium">detectResult</div>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(run.detectResult, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-sm font-medium">stats</div>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(run.stats, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>错误与告警</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-medium">errors</div>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(run.errors, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-sm font-medium">warnings</div>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(run.warnings, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
