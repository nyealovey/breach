#!/usr/bin/env bun

import { createEcsClient, describeEcsInstancesPage } from './ecs-client';
import { retryDelaysMsForErrorCode, toAliyunError } from './errors';
import { normalizeEcsVm, normalizeRdsVm } from './normalize';
import { createRdsClient, describeRdsInstancesPage } from './rds-client';
import type { AliyunConfig, CollectorError, CollectorRequestV1, CollectorResponseV1 } from './types';

type NormalizedConfig = {
  endpoint: string;
  regions: string[];
  timeoutMs: number;
  maxParallelRegions: number;
  includeStopped: boolean;
  includeEcs: boolean;
  includeRds: boolean;
};

function makeResponse(partial: Partial<CollectorResponseV1>): CollectorResponseV1 {
  return {
    schema_version: 'collector-response-v1',
    assets: [],
    relations: [],
    stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
    errors: [],
    ...partial,
  };
}

async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizeConfig(
  config: AliyunConfig,
): { ok: true; config: NormalizedConfig } | { ok: false; error: CollectorError } {
  const endpoint = typeof config.endpoint === 'string' ? config.endpoint.trim() : '';
  if (!endpoint) {
    return {
      ok: false,
      error: { code: 'ALIYUN_CONFIG_INVALID', category: 'config', message: 'missing endpoint', retryable: false },
    };
  }

  const regions = Array.isArray(config.regions)
    ? Array.from(
        new Set(config.regions.map((r) => (typeof r === 'string' ? r.trim() : '')).filter((r) => r.length > 0)),
      )
    : [];
  if (regions.length === 0) {
    return {
      ok: false,
      error: { code: 'ALIYUN_CONFIG_INVALID', category: 'config', message: 'missing regions', retryable: false },
    };
  }

  const includeEcs = config.include_ecs === undefined ? true : !!config.include_ecs;
  const includeRds = config.include_rds === undefined ? true : !!config.include_rds;
  if (!includeEcs && !includeRds) {
    return {
      ok: false,
      error: {
        code: 'ALIYUN_CONFIG_INVALID',
        category: 'config',
        message: 'include_ecs/include_rds must enable at least one collector',
        retryable: false,
      },
    };
  }

  const timeoutMs =
    typeof config.timeout_ms === 'number' && Number.isFinite(config.timeout_ms) && config.timeout_ms > 0
      ? Math.floor(config.timeout_ms)
      : 60_000;
  const maxParallelRegions = clampPositiveInt(config.max_parallel_regions, 3);
  const includeStopped = config.include_stopped === undefined ? true : !!config.include_stopped;

  return {
    ok: true,
    config: { endpoint, regions, timeoutMs, maxParallelRegions, includeStopped, includeEcs, includeRds },
  };
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  ctx: { stage: string; extra?: Record<string, unknown> },
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const issue = toAliyunError(err, ctx.stage, ctx.extra);
      const delays = retryDelaysMsForErrorCode(issue.code);
      const delay = attempt < delays.length ? (delays[attempt] ?? null) : null;
      if (delay === null) throw err;
      attempt += 1;
      await sleep(delay);
    }
  }
}

async function healthcheck(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const cfgResult = normalizeConfig(request.source.config);
  if (!cfgResult.ok) return { response: makeResponse({ errors: [cfgResult.error] }), exitCode: 1 };
  const cfg = cfgResult.config;

  const { accessKeyId, accessKeySecret } = request.source.credential ?? ({} as any);
  if (!accessKeyId || !accessKeySecret) {
    return {
      response: makeResponse({
        errors: [
          { code: 'ALIYUN_CONFIG_INVALID', category: 'config', message: 'missing credential', retryable: false },
        ],
      }),
      exitCode: 1,
    };
  }

  const regionId = cfg.regions[0]!;
  try {
    if (cfg.includeEcs) {
      const ecs = createEcsClient({ accessKeyId, accessKeySecret, regionId });
      await callWithRetry(
        () =>
          describeEcsInstancesPage({
            client: ecs,
            regionId,
            timeoutMs: cfg.timeoutMs,
            includeStopped: true,
            maxResults: 10,
          }),
        { stage: 'healthcheck.ecs', extra: { region: regionId } },
      );
    }

    if (cfg.includeRds) {
      const rds = createRdsClient({ accessKeyId, accessKeySecret, regionId });
      await callWithRetry(
        () => describeRdsInstancesPage({ client: rds, regionId, timeoutMs: cfg.timeoutMs, maxResults: 10 }),
        { stage: 'healthcheck.rds', extra: { region: regionId } },
      );
    }

    return { response: makeResponse({ errors: [] }), exitCode: 0 };
  } catch (err) {
    return {
      response: makeResponse({
        errors: [toAliyunError(err, 'healthcheck', { region: regionId })],
      }),
      exitCode: 1,
    };
  }
}

async function detect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const cfgResult = normalizeConfig(request.source.config);
  if (!cfgResult.ok) return { response: makeResponse({ errors: [cfgResult.error] }), exitCode: 1 };
  const cfg = cfgResult.config;

  return {
    response: makeResponse({
      detect: {
        target_version: 'aliyun-ecs-rds',
        capabilities: {
          regions: cfg.regions,
          include_stopped: cfg.includeStopped,
          include_ecs: cfg.includeEcs,
          include_rds: cfg.includeRds,
        },
        driver: 'aliyun-sdk-v2',
      },
      errors: [],
    }),
    exitCode: 0,
  };
}

type RegionCollectResult = { ok: true; assets: CollectorResponseV1['assets'] } | { ok: false; error: CollectorError };

async function collectRegion(args: {
  regionId: string;
  cfg: NormalizedConfig;
  credential: { accessKeyId: string; accessKeySecret: string };
}): Promise<RegionCollectResult> {
  const { regionId, cfg, credential } = args;
  try {
    const assets: CollectorResponseV1['assets'] = [];

    if (cfg.includeEcs) {
      const client = createEcsClient({ ...credential, regionId });
      let nextToken: string | undefined = undefined;
      while (true) {
        const page = await callWithRetry(
          () =>
            describeEcsInstancesPage({
              client,
              regionId,
              timeoutMs: cfg.timeoutMs,
              nextToken,
              includeStopped: cfg.includeStopped,
            }),
          { stage: 'collect.ecs', extra: { region: regionId } },
        );
        for (const instance of page.instances) {
          assets.push(normalizeEcsVm({ raw: instance as any, regionId }));
        }
        if (!page.nextToken) break;
        nextToken = page.nextToken;
      }
    }

    if (cfg.includeRds) {
      const client = createRdsClient({ ...credential, regionId });
      let nextToken: string | undefined = undefined;
      while (true) {
        const page = await callWithRetry(
          () =>
            describeRdsInstancesPage({
              client,
              regionId,
              timeoutMs: cfg.timeoutMs,
              nextToken,
            }),
          { stage: 'collect.rds', extra: { region: regionId } },
        );
        for (const instance of page.instances) {
          assets.push(normalizeRdsVm({ raw: instance as any, regionId }));
        }
        if (!page.nextToken) break;
        nextToken = page.nextToken;
      }
    }

    return { ok: true, assets };
  } catch (err) {
    return { ok: false, error: toAliyunError(err, 'collect', { region: regionId }) };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  const queue = items.slice();

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      out.push(await fn(item));
    }
  });

  await Promise.all(workers);
  return out;
}

async function collect(request: CollectorRequestV1): Promise<{ response: CollectorResponseV1; exitCode: number }> {
  const cfgResult = normalizeConfig(request.source.config);
  if (!cfgResult.ok) return { response: makeResponse({ errors: [cfgResult.error] }), exitCode: 1 };
  const cfg = cfgResult.config;

  const accessKeyId =
    typeof request.source.credential?.accessKeyId === 'string' ? request.source.credential.accessKeyId.trim() : '';
  const accessKeySecret =
    typeof request.source.credential?.accessKeySecret === 'string'
      ? request.source.credential.accessKeySecret.trim()
      : '';
  if (!accessKeyId || !accessKeySecret) {
    return {
      response: makeResponse({
        errors: [
          { code: 'ALIYUN_CONFIG_INVALID', category: 'config', message: 'missing credential', retryable: false },
        ],
      }),
      exitCode: 1,
    };
  }

  const regionResults = await mapLimit(cfg.regions, cfg.maxParallelRegions, (regionId) =>
    collectRegion({ regionId, cfg, credential: { accessKeyId, accessKeySecret } }),
  );

  const errors = regionResults
    .filter((r): r is Extract<RegionCollectResult, { ok: false }> => !r.ok)
    .map((r) => r.error);
  if (errors.length > 0) {
    return {
      response: makeResponse({
        assets: [],
        relations: [],
        stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
        errors,
      }),
      exitCode: 1,
    };
  }

  const assets = regionResults.flatMap((r) => (r.ok ? r.assets : []));
  return {
    response: makeResponse({
      assets,
      relations: [],
      stats: { assets: assets.length, relations: 0, inventory_complete: true, warnings: [] },
      errors: [],
    }),
    exitCode: 0,
  };
}

async function main(): Promise<number> {
  let parsed: unknown;
  try {
    parsed = await readStdinJson();
  } catch {
    const response = makeResponse({
      errors: [{ code: 'ALIYUN_PARSE_ERROR', category: 'parse', message: 'invalid input json', retryable: false }],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  const request = parsed as CollectorRequestV1;
  if (request.schema_version !== 'collector-request-v1') {
    const response = makeResponse({
      errors: [
        { code: 'ALIYUN_CONFIG_INVALID', category: 'config', message: 'unsupported schema_version', retryable: false },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  if (request.source.source_type !== 'aliyun') {
    const response = makeResponse({
      errors: [
        { code: 'ALIYUN_CONFIG_INVALID', category: 'config', message: 'unsupported source_type', retryable: false },
      ],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  if (!request.source.config?.endpoint) {
    const response = makeResponse({
      errors: [{ code: 'ALIYUN_CONFIG_INVALID', category: 'config', message: 'missing endpoint', retryable: false }],
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 1;
  }

  const mode = request.request?.mode;
  const result =
    mode === 'collect'
      ? await collect(request)
      : mode === 'detect'
        ? await detect(request)
        : await healthcheck(request);

  process.stdout.write(`${JSON.stringify(result.response)}\n`);
  return result.exitCode;
}

process.exitCode = await main();
