import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">资产台账（vCenter MVP）</h1>
      <p className="text-sm text-muted-foreground">
        从左侧导航开始：配置调度组、创建 Source、触发 Run，然后在资产页查看统一视图与关系链。
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">调度组</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Link className="text-primary underline-offset-4 hover:underline" href="/schedule-groups">
              前往配置
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">来源</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Link className="text-primary underline-offset-4 hover:underline" href="/sources">
              前往配置
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">运行</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Link className="text-primary underline-offset-4 hover:underline" href="/runs">
              查看列表
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
