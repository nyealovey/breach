import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getServerSession } from '@/lib/auth/server-session';

export default async function Home() {
  const session = await getServerSession();
  const isAdmin = session?.user.role === 'admin';

  return (
    <div className="space-y-6">
      <PageHeader
        title="资产台账（vCenter MVP）"
        description="从顶部导航开始：配置调度组，在「配置中心」创建来源/凭据，触发 Run，然后在资产页查看统一视图与关系链。"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isAdmin ? (
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
        ) : null}

        {isAdmin ? (
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
        ) : null}

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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">资产</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Link className="text-primary underline-offset-4 hover:underline" href="/assets">
              查看列表
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
