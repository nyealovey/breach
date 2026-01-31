import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CreateAssetLedgerExportButton } from '@/components/exports/create-asset-ledger-export-button';
import { prisma } from '@/lib/db/prisma';
import { getServerSession } from '@/lib/auth/server-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default async function ExportsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');
  if (session.user.role !== 'admin') redirect('/assets');

  const exports = await prisma.assetLedgerExport.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { requestedByUser: { select: { username: true } } },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>导出</CardTitle>
        <CreateAssetLedgerExportButton />
      </CardHeader>
      <CardContent>
        {exports.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无导出任务。</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Export ID</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>行数</TableHead>
                <TableHead>文件</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作者</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exports.map((exp) => (
                <TableRow key={exp.id}>
                  <TableCell className="font-mono text-xs">{exp.id}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        exp.status === 'Failed' ? 'destructive' : exp.status === 'Succeeded' ? 'default' : 'secondary'
                      }
                    >
                      {exp.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{exp.rowCount ?? '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{exp.fileName ?? '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{exp.createdAt.toISOString()}</TableCell>
                  <TableCell className="text-xs">{exp.requestedByUser?.username ?? '-'}</TableCell>
                  <TableCell className="text-right">
                    {exp.status === 'Succeeded' ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/api/v1/exports/asset-ledger/${exp.id}/download`}>下载</Link>
                      </Button>
                    ) : exp.status === 'Failed' ? (
                      <span className="text-xs text-muted-foreground">失败</span>
                    ) : exp.status === 'Expired' ? (
                      <span className="text-xs text-muted-foreground">已失效</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">生成中…</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
