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

const SourceTypeSchema = z.enum(['vcenter', 'pve', 'hyperv', 'aliyun', 'third_party', 'solarwinds']);
const RunModeSchema = z.enum(['collect', 'collect_hosts', 'collect_vms', 'detect', 'healthcheck']);
const ScheduleGroupRunModeSchema = z.enum(['collect', 'detect', 'healthcheck']);

const LedgerFieldsV1Schema = z.object({
  region: z.string().nullable(),
  company: z.string().nullable(),
  department: z.string().nullable(),
  systemCategory: z.string().nullable(),
  systemLevel: z.string().nullable(),
  bizOwner: z.string().nullable(),
  maintenanceDueDate: z.string().nullable(),
  purchaseDate: z.string().nullable(),
  bmcIp: z.string().nullable(),
  cabinetNo: z.string().nullable(),
  rackPosition: z.string().nullable(),
  managementCode: z.string().nullable(),
  fixedAssetNo: z.string().nullable(),
});

const AssetOperationalStateSchema = z.object({
  monitorCovered: z.boolean().nullable(),
  monitorState: z.string().nullable(),
  monitorStatus: z.string().nullable(),
  monitorUpdatedAt: z.string().nullable(),
});

const AssetListItemSchema = z.object({
  assetUuid: z.string(),
  assetType: z.string(),
  status: z.string(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  machineName: z.string().nullable(),
  machineNameOverride: z.string().nullable(),
  machineNameCollected: z.string().nullable(),
  machineNameMismatch: z.boolean(),
  hostName: z.string().nullable(),
  vmName: z.string().nullable(),
  os: z.string().nullable(),
  osCollected: z.string().nullable(),
  osOverrideText: z.string().nullable(),
  vmPowerState: z.string().nullable(),
  toolsRunning: z.boolean().nullable(),
  ip: z.string().nullable(),
  ipCollected: z.string().nullable(),
  ipOverrideText: z.string().nullable(),
  recordedAt: z.string(),
  monitorCovered: z.boolean().nullable(),
  monitorState: z.string().nullable(),
  monitorStatus: z.string().nullable(),
  monitorUpdatedAt: z.string().nullable(),
  ledgerFields: LedgerFieldsV1Schema,
  cpuCount: z.number().int().nullable(),
  memoryBytes: z.number().int().nullable(),
  totalDiskBytes: z.number().int().nullable(),
});

const SolarWindsNodeCandidateSchema = z.object({
  nodeId: z.string(),
  caption: z.string().nullable(),
  sysName: z.string().nullable(),
  dns: z.string().nullable(),
  ipAddress: z.string().nullable(),
  machineType: z.string().nullable(),
  status: z.union([z.number().int(), z.string()]).nullable(),
  statusDescription: z.string().nullable(),
  unmanaged: z.boolean().nullable(),
  lastSyncIso: z.string().nullable(),
});

const SolarWindsCollectCandidateSchema = SolarWindsNodeCandidateSchema.extend({
  matchScore: z.number().int(),
  matchReasons: z.array(z.string()),
});

const SolarWindsTargetedCollectResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('no_source') }),
  z.object({ status: z.literal('no_match'), hints: z.unknown().optional() }),
  z.object({ status: z.literal('ambiguous'), candidates: z.array(SolarWindsCollectCandidateSchema) }),
  z.object({
    status: z.literal('ok'),
    runId: z.string(),
    linkId: z.string(),
    collectedAt: z.string(),
    node: SolarWindsNodeCandidateSchema,
    fields: z.object({
      machineName: z.string().nullable(),
      ipText: z.string().nullable(),
      osText: z.string().nullable(),
    }),
  }),
]);

const CredentialListItemSchema = z.object({
  credentialId: z.string(),
  name: z.string(),
  type: SourceTypeSchema,
  account: z.string().nullable(),
  usageCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const TriggerRunResponseSchema = z.object({
  runId: z.string(),
  sourceId: z.string(),
  mode: RunModeSchema,
  triggerType: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

const DuplicateCandidateStatusSchema = z.enum(['open', 'ignored', 'merged']);
const DuplicateCandidateConfidenceSchema = z.enum(['High', 'Medium']);
const DuplicateCandidateAssetSummarySchema = z.object({
  assetUuid: z.string(),
  assetType: z.string(),
  status: z.string(),
  displayName: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
});
const DuplicateCandidateListItemSchema = z.object({
  candidateId: z.string(),
  status: DuplicateCandidateStatusSchema,
  score: z.number().int(),
  confidence: DuplicateCandidateConfidenceSchema,
  lastObservedAt: z.string(),
  assetA: DuplicateCandidateAssetSummarySchema,
  assetB: DuplicateCandidateAssetSummarySchema,
});
const DuplicateCandidateSourceLinkSchema = z.object({
  sourceId: z.string(),
  sourceName: z.string(),
  externalKind: z.string(),
  externalId: z.string(),
  presenceStatus: z.string(),
  lastSeenAt: z.string(),
  lastSeenRunId: z.string().nullable(),
});
const DuplicateCandidateDetailSchema = z.object({
  candidateId: z.string(),
  status: DuplicateCandidateStatusSchema,
  score: z.number().int(),
  confidence: DuplicateCandidateConfidenceSchema,
  reasons: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastObservedAt: z.string(),
  ignore: z
    .object({
      ignoredByUserId: z.string().nullable(),
      ignoredAt: z.string().nullable(),
      ignoreReason: z.string().nullable(),
    })
    .nullable(),
  assetA: DuplicateCandidateAssetSummarySchema.extend({ sourceLinks: z.array(DuplicateCandidateSourceLinkSchema) }),
  assetB: DuplicateCandidateAssetSummarySchema.extend({ sourceLinks: z.array(DuplicateCandidateSourceLinkSchema) }),
});
const IgnoreDuplicateCandidateResponseSchema = z.object({
  candidateId: z.string(),
  status: DuplicateCandidateStatusSchema,
  ignoredAt: z.string().nullable(),
  ignoreReason: z.string().nullable(),
});

const MergeConflictStrategySchema = z.enum(['primary_wins']);
const MergeAssetsRequestSchema = z.object({
  mergedAssetUuids: z.array(z.string()).min(1),
  conflictStrategy: MergeConflictStrategySchema.optional(),
});
const MergeAssetsResponseSchema = z.object({
  primaryAssetUuid: z.string(),
  mergedAssetUuids: z.array(z.string()).min(1),
  conflictStrategy: MergeConflictStrategySchema,
  mergeAuditIds: z.array(z.string()),
  migrated: z.object({
    assetsUpdatedCount: z.number().int(),
    sourceLinksMovedCount: z.number().int(),
    sourceRecordsMovedCount: z.number().int(),
    relationsRewrittenCount: z.number().int(),
    dedupedRelationsCount: z.number().int(),
    duplicateCandidatesUpdatedCount: z.number().int(),
  }),
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
      status: z.enum(['in_service', 'offline']).optional(),
      brand: z.string().optional(),
      model: z.string().optional(),
      source_id: z.string().optional(),
      exclude_asset_type: z.string().optional(),
      region: z.string().optional(),
      company: z.string().optional(),
      department: z.string().optional(),
      system_category: z.string().optional(),
      system_level: z.string().optional(),
      biz_owner: z.string().optional(),
      os: z.string().optional(),
      vm_power_state: z.enum(['poweredOn', 'poweredOff', 'suspended']).optional(),
      ip_missing: z.enum(['true']).optional(),
      machine_name_missing: z.enum(['true']).optional(),
      machine_name_vmname_mismatch: z.enum(['true']).optional(),
      created_within_days: z.coerce.number().int().positive().optional(),
    }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okPaginatedResponse(AssetListItemSchema) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/assets/{uuid}/merge',
  tags: ['assets'],
  request: {
    params: z.object({ uuid: z.string() }),
    body: {
      content: {
        'application/json': { schema: MergeAssetsRequestSchema },
      },
    },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okResponse(MergeAssetsResponseSchema) } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: failResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/duplicate-candidates',
  tags: ['duplicate-candidates'],
  request: {
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().optional(),
      status: DuplicateCandidateStatusSchema.optional(),
      assetType: z.enum(['vm', 'host']).optional(),
      confidence: DuplicateCandidateConfidenceSchema.optional(),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: okPaginatedResponse(DuplicateCandidateListItemSchema) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/duplicate-candidates/{candidateId}',
  tags: ['duplicate-candidates'],
  request: { params: z.object({ candidateId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okResponse(DuplicateCandidateDetailSchema) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/duplicate-candidates/{candidateId}/ignore',
  tags: ['duplicate-candidates'],
  request: {
    params: z.object({ candidateId: z.string() }),
    body: {
      content: {
        'application/json': { schema: z.object({ reason: z.string().optional() }) },
      },
    },
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: okResponse(IgnoreDuplicateCandidateResponseSchema) } },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: failResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

const PreferenceKeySchema = z.enum(['assets.table.columns.v1', 'assets.table.columns.v2']);
const AssetsTableColumnsPreferenceValueSchema = z.object({
  visibleColumns: z.array(z.string()).min(1),
});
const UserPreferenceSchema = z.object({
  key: PreferenceKeySchema,
  value: AssetsTableColumnsPreferenceValueSchema,
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/me/preferences',
  tags: ['me'],
  request: {
    query: z.object({
      key: PreferenceKeySchema,
    }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okResponse(UserPreferenceSchema) } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/me/preferences',
  tags: ['me'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: PreferenceKeySchema,
            value: AssetsTableColumnsPreferenceValueSchema,
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okResponse(UserPreferenceSchema) } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/credentials',
  tags: ['credentials'],
  request: {
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().optional(),
      type: SourceTypeSchema.optional(),
      q: z.string().optional(),
      sortBy: z.enum(['createdAt', 'updatedAt', 'name']).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: okPaginatedResponse(CredentialListItemSchema) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/credentials',
  tags: ['credentials'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ name: z.string().min(1), type: SourceTypeSchema, payload: z.unknown() }),
        },
      },
    },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: okResponse(CredentialListItemSchema) } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: failResponse } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/credentials/{id}',
  tags: ['credentials'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okResponse(CredentialListItemSchema) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/credentials/{id}',
  tags: ['credentials'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ name: z.string().min(1).optional(), payload: z.unknown().optional() }),
        },
      },
    },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okResponse(CredentialListItemSchema) } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/credentials/{id}',
  tags: ['credentials'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'No Content' },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/schedule-groups/{id}/runs',
  tags: ['schedule-groups'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ mode: ScheduleGroupRunModeSchema.optional() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: okResponse(
            z.object({
              queued: z.number().int(),
              skipped_active: z.number().int(),
              skipped_missing_credential: z.number().int(),
              skipped_missing_config: z.number().int(),
              message: z.string(),
            }),
          ),
        },
      },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/sources/{id}/runs',
  tags: ['sources'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ mode: RunModeSchema }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'OK (suppressed due to active run)',
      content: {
        'application/json': {
          schema: okResponse(
            z.object({ runId: z.string(), sourceId: z.string(), status: z.string(), message: z.string() }),
          ),
        },
      },
    },
    201: { description: 'Created', content: { 'application/json': { schema: okResponse(TriggerRunResponseSchema) } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
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
              mergedIntoAssetUuid: z.string().nullable(),
              displayName: z.string().nullable(),
              machineNameOverride: z.string().nullable(),
              ipOverrideText: z.string().nullable(),
              osOverrideText: z.string().nullable(),
              lastSeenAt: z.string().nullable(),
              ledgerFields: LedgerFieldsV1Schema,
              operationalState: AssetOperationalStateSchema,
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
  method: 'put',
  path: '/api/v1/assets/{uuid}',
  tags: ['assets'],
  request: {
    params: z.object({ uuid: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            machineNameOverride: z.string().nullable().optional(),
            ipOverrideText: z.string().nullable().optional(),
            osOverrideText: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: okResponse(
            z.object({
              assetUuid: z.string(),
              machineNameOverride: z.string().nullable(),
              ipOverrideText: z.string().nullable(),
              osOverrideText: z.string().nullable(),
            }),
          ),
        },
      },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: failResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/assets/{uuid}/solarwinds/collect',
  tags: ['assets'],
  request: {
    params: z.object({ uuid: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ nodeId: z.string().min(1).optional() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: okResponse(SolarWindsTargetedCollectResponseSchema),
        },
      },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: failResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: failResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: failResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: failResponse } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: failResponse } } },
    502: { description: 'Bad gateway', content: { 'application/json': { schema: failResponse } } },
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
                sourceName: z.string().nullable(),
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
