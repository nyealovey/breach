import EcsClient, { DescribeInstancesRequest } from '@alicloud/ecs20140526';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import * as $dara from '@darabonba/typescript';

import type { DescribeInstancesResponseBodyInstancesInstance } from '@alicloud/ecs20140526';

export function createEcsClient(args: { accessKeyId: string; accessKeySecret: string; regionId: string }): EcsClient {
  const config = new $OpenApiUtil.Config({
    accessKeyId: args.accessKeyId,
    accessKeySecret: args.accessKeySecret,
    regionId: args.regionId,
    endpoint: 'ecs.aliyuncs.com',
  });
  return new EcsClient(config);
}

export async function describeEcsInstancesPage(args: {
  client: EcsClient;
  regionId: string;
  timeoutMs: number;
  nextToken?: string;
  includeStopped: boolean;
  maxResults?: number;
}): Promise<{ instances: DescribeInstancesResponseBodyInstancesInstance[]; nextToken: string | null }> {
  const runtime = new $dara.RuntimeOptions({ readTimeout: args.timeoutMs, connectTimeout: args.timeoutMs });

  const request = new DescribeInstancesRequest({
    regionId: args.regionId,
    maxResults: args.maxResults ?? 100,
    ...(args.nextToken ? { nextToken: args.nextToken } : {}),
    ...(args.includeStopped ? {} : { status: 'Running' }),
  });

  const res = await args.client.describeInstancesWithOptions(request, runtime);
  const instances = res.body?.instances?.instance ?? [];
  const nextToken = res.body?.nextToken?.trim() ? res.body.nextToken.trim() : null;
  return { instances, nextToken };
}
