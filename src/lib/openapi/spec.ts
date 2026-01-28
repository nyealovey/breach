import { z } from 'zod/v4';

import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const ResponseMetaSchema = z.object({
  requestId: z.string(),
  timestamp: z.string(),
});

const PaginationSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

const AppErrorSchema = z.object({
  code: z.string(),
  category: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  redacted_context: z.record(z.string(), z.unknown()).optional(),
  details: z
    .array(z.object({ field: z.string().optional(), issue: z.string().optional(), message: z.string().optional() }))
    .optional(),
});

function okResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ data: dataSchema, meta: ResponseMetaSchema });
}

function okPaginatedResponse<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({ data: z.array(itemSchema), pagination: PaginationSchema, meta: ResponseMetaSchema });
}

const failResponse = z.object({ error: AppErrorSchema, meta: ResponseMetaSchema });

// ===== Schemas used by MVP UI =====

const AssetListItemSchema = z.object({
  assetUuid: z.string(),
  assetType: z.string(),
  status: z.string(),
  displayName: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  sources: z.array(z.object({ sourceId: z.string(), name: z.string() })),
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/assets',
  tags: ['assets'],
  request: {
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().optional(),
      q: z.string().optional(),
      asset_type: z.string().optional(),
      source_id: z.string().optional(),
    }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okPaginatedResponse(AssetListItemSchema) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/assets/{uuid}',
  tags: ['assets'],
  request: { params: z.object({ uuid: z.string() }) },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: okResponse(
            z.object({
              assetUuid: z.string(),
              assetType: z.string(),
              status: z.string(),
              displayName: z.string().nullable(),
              lastSeenAt: z.string().nullable(),
              latestSnapshot: z
                .object({
                  runId: z.string(),
                  createdAt: z.string(),
                  canonical: z.unknown(),
                })
                .nullable(),
            }),
          ),
        },
      },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/assets/{uuid}/source-records',
  tags: ['assets'],
  request: { params: z.object({ uuid: z.string() }) },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: okResponse(
            z.array(
              z.object({
                recordId: z.string(),
                collectedAt: z.string(),
                runId: z.string(),
                sourceId: z.string(),
                externalKind: z.string(),
                externalId: z.string(),
                normalized: z.unknown(),
              }),
            ),
          ),
        },
      },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/assets/{uuid}/relations',
  tags: ['assets'],
  request: { params: z.object({ uuid: z.string() }) },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: okResponse(
            z.array(
              z.object({
                relationId: z.string(),
                relationType: z.string(),
                toAssetUuid: z.string(),
                toAssetType: z.string().nullable(),
                toDisplayName: z.string().nullable(),
                sourceId: z.string(),
                lastSeenAt: z.string(),
              }),
            ),
          ),
        },
      },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/source-records/{recordId}/raw',
  tags: ['raw'],
  request: { params: z.object({ recordId: z.string() }) },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: okResponse(
            z.object({
              rawPayload: z.unknown(),
              meta: z.object({
                hash: z.string(),
                sizeBytes: z.number().int(),
                compression: z.string(),
                collectedAt: z.string(),
                runId: z.string(),
                sourceId: z.string(),
              }),
            }),
          ),
        },
      },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

export function getOpenApiSpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: { title: 'Asset Ledger API', version: 'v1.0' },
  });
}
