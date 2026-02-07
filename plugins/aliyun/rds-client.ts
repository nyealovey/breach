import RdsClient, { DescribeDBInstancesRequest } from '@alicloud/rds20140815';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import * as $dara from '@darabonba/typescript';

import type { DescribeDBInstancesResponseBodyItemsDBInstance } from '@alicloud/rds20140815';

export function createRdsClient(args: { accessKeyId: string; accessKeySecret: string; regionId: string }): RdsClient {
  const config = new $OpenApiUtil.Config({
    accessKeyId: args.accessKeyId,
    accessKeySecret: args.accessKeySecret,
    regionId: args.regionId,
    endpoint: 'rds.aliyuncs.com',
  });
  return new RdsClient(config);
}

export async function describeRdsInstancesPage(args: {
  client: RdsClient;
  regionId: string;
  timeoutMs: number;
  nextToken?: string;
  maxResults?: number;
}): Promise<{ instances: DescribeDBInstancesResponseBodyItemsDBInstance[]; nextToken: string | null }> {
  const runtime = new $dara.RuntimeOptions({ readTimeout: args.timeoutMs, connectTimeout: args.timeoutMs });

  const request = new DescribeDBInstancesRequest({
    regionId: args.regionId,
    instanceLevel: 1,
    maxResults: args.maxResults ?? 100,
    ...(args.nextToken ? { nextToken: args.nextToken } : {}),
  });

  const res = await args.client.describeDBInstancesWithOptions(request, runtime);
  const instances = res.body?.items?.DBInstance ?? [];
  const nextToken = res.body?.nextToken?.trim() ? res.body.nextToken.trim() : null;
  return { instances, nextToken };
}
