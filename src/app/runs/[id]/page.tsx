'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IdText } from '@/components/ui/id-text';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { RunIssuesPanel } from '@/components/runs/run-issues-panel';
import { getRunErrorUiMeta } from '@/lib/runs/run-error-actions';
import { getPrimaryRunIssue, sanitizeRedactedContext } from '@/lib/runs/run-issues';

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
  errorSummary: string | null;
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

  const primaryIssue =
    run.status === 'Failed'
      ? getPrimaryRunIssue({ status: run.status, errors: run.errors, errorSummary: run.errorSummary })
      : null;
  const primaryMeta = primaryIssue ? getRunErrorUiMeta(primaryIssue.code) : null;
  const primaryContext = primaryIssue ? sanitizeRedactedContext(primaryIssue.redacted_context) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Run 详情"
        meta={<IdText value={run.runId} className="text-foreground" />}
        description={`${run.sourceName ?? run.sourceId} · ${run.mode} · ${run.triggerType} · ${run.status}`}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/runs">返回列表</Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <Card>
            <CardHeader>
              <CardTitle>概览</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableCell>
                      <IdText value={run.runId} className="text-foreground" />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>来源</TableHead>
                    <TableCell>
                      {run.sourceName ?? <IdText value={run.sourceId} className="text-foreground" />}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>模式</TableHead>
                    <TableCell className="font-mono text-xs">{run.mode}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>触发方式</TableHead>
                    <TableCell className="font-mono text-xs">{run.triggerType}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>状态</TableHead>
                    <TableCell>{run.status}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>开始时间</TableHead>
                    <TableCell className="font-mono text-xs">{run.startedAt ?? '-'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>结束时间</TableHead>
                    <TableCell className="font-mono text-xs">{run.finishedAt ?? '-'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>耗时</TableHead>
                    <TableCell className="font-mono text-xs">{run.durationMs} ms</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {run.status === 'Failed' ? (
            <Card>
              <CardHeader>
                <CardTitle>失败原因</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {primaryIssue ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-mono text-sm">{primaryIssue.code}</div>
                      <div className="text-sm text-muted-foreground">{primaryMeta?.title ?? '-'}</div>
                      <Badge variant={primaryIssue.retryable ? 'default' : 'secondary'}>
                        {primaryIssue.retryable ? '可重试' : '不可重试'}
                      </Badge>
                      {primaryIssue.missingStructuredErrors ? (
                        <Badge variant="destructive">缺少结构化 errors</Badge>
                      ) : null}
                    </div>

                    <div className="text-sm">{primaryIssue.message}</div>

                    {primaryContext ? (
                      <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
                        {JSON.stringify(primaryContext, null, 2)}
                      </pre>
                    ) : null}

                    <div className="space-y-3">
                      <div className="text-sm font-medium">建议动作</div>
                      <div className="space-y-3">
                        {(primaryMeta?.actions ?? []).map((action, idx) => (
                          <div key={idx} className="rounded-md border bg-background p-3">
                            <div className="text-sm font-medium">{action.title}</div>
                            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                              {action.steps.map((step, stepIdx) => (
                                <li key={stepIdx}>{step}</li>
                              ))}
                            </ol>
                            {action.links?.length ? (
                              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                                {action.links.map((link) => (
                                  <Link key={link.href} href={link.href} className="underline">
                                    {link.label}
                                  </Link>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    该 Run 状态为 Failed，但没有可展示的结构化错误信息。
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

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
        </div>

        <div className="space-y-6 lg:col-span-4">
          <RunIssuesPanel title="errors" issues={run.errors} defaultOpen />
          <RunIssuesPanel title="warnings" issues={run.warnings} />
        </div>
      </div>
    </div>
  );
}
