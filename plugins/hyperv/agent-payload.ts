import { buildClusterInventory, buildStandaloneInventory } from './inventory';
import type { CollectorError } from './types';

type InventoryBuildResult = ReturnType<typeof buildStandaloneInventory>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseError(cause: string): InventoryBuildResult {
  const error: CollectorError = {
    code: 'HYPERV_PARSE_ERROR',
    category: 'parse',
    message: 'invalid agent payload',
    retryable: false,
    redacted_context: { mode: 'collect', cause },
  };
  return {
    assets: [],
    relations: [],
    stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
    errors: [error],
    exitCode: 1,
  };
}

export function buildInventoryFromAgentPayload(raw: unknown): InventoryBuildResult {
  if (!isRecord(raw)) return parseError('payload not object');
  const scope = typeof raw.scope === 'string' ? raw.scope.trim() : '';
  if (scope === 'cluster') return buildClusterInventory(raw);
  if (scope === 'standalone') return buildStandaloneInventory(raw);
  return parseError('missing or invalid scope');
}
