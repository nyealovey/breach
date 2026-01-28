'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ScheduleGroup = {
  groupId: string;
  name: string;
  enabled: boolean;
  timezone: string;
  runAtHhmm: string;
  sourceCount: number;
  lastTriggeredOn: string | null;
};

export default function ScheduleGroupsPage() {
  const [groups, setGroups] = useState<ScheduleGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const res = await fetch('/api/v1/schedule-groups');
      if (!res.ok) {
        setGroups([]);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as { data: ScheduleGroup[] };
      if (active) {
        setGroups(body.data ?? []);
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>调度组</CardTitle>
        <Button asChild>
          <Link href="/schedule-groups/new">新建调度组</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">加载中…</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无调度组，点击「新建调度组」开始配置。</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>启用</TableHead>
                <TableHead>时区</TableHead>
                <TableHead>触发时间</TableHead>
                <TableHead>来源数量</TableHead>
                <TableHead>上次触发</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.groupId}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell>{group.enabled ? '启用' : '停用'}</TableCell>
                  <TableCell>{group.timezone}</TableCell>
                  <TableCell>{group.runAtHhmm}</TableCell>
                  <TableCell>{group.sourceCount}</TableCell>
                  <TableCell>{group.lastTriggeredOn ?? '-'}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/schedule-groups/${group.groupId}/edit`}>编辑</Link>
                    </Button>
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
