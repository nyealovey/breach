import { calculateDupScoreV1 } from '@/lib/duplicate-candidates/dup-rules-v1';

import type { DupRulesV1AssetType, DupRulesV1Match } from '@/lib/duplicate-candidates/dup-rules-v1';

export type CandidateAssetInput = {
  assetUuid: string;
  normalized: unknown;
};

export type DuplicateCandidateDraft = {
  assetUuidA: string;
  assetUuidB: string;
  score: number;
  reasons: DupRulesV1Match[];
};

function getNested(obj: unknown, path: Array<string>): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  let cur: any = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

const PLACEHOLDER_BLACKLIST = new Set(
  [
    'n/a',
    'na',
    'unknown',
    'none',
    'null',
    '-',
    '--',
    '---',
    '0',
    '00000000-0000-0000-0000-000000000000',
    '00000000000000000000000000000000',
    '00:00:00:00:00:00',
    'ff:ff:ff:ff:ff:ff',
    '00-00-00-00-00-00',
    'ff-ff-ff-ff-ff-ff',
    '000000000000',
    'ffffffffffff',
    'to be filled',
    'to be filled by o.e.m.',
  ].map((v) => v.trim().toLowerCase()),
);

function isPlaceholder(value: string) {
  const raw = value.trim().toLowerCase();
  if (PLACEHOLDER_BLACKLIST.has(raw)) return true;
  const compact = raw.replace(/[-:\s]/g, '');
  if (PLACEHOLDER_BLACKLIST.has(compact)) return true;
  return false;
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim() === '') return null;
  if (isPlaceholder(value)) return null;
  return value.trim().toLowerCase().replace(/-/g, '');
}

function normalizeMac(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim() === '') return null;
  if (isPlaceholder(value)) return null;
  const compact = value.trim().toLowerCase().replace(/[-:.]/g, '');
  if (compact === '' || isPlaceholder(compact)) return null;
  return compact;
}

function normalizeMacs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const out: string[] = [];
  for (const v of value) {
    const normalized = normalizeMac(v);
    if (!normalized) continue;
    out.push(normalized);
  }
  return Array.from(new Set(out));
}

function normalizeHostname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || isPlaceholder(trimmed)) return null;
  return trimmed.toLowerCase();
}

function normalizeIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || isPlaceholder(trimmed)) return null;
  return trimmed.toLowerCase();
}

function normalizeIps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const out: string[] = [];
  for (const v of value) {
    const normalized = normalizeIp(v);
    if (!normalized) continue;
    out.push(normalized);
  }
  return Array.from(new Set(out));
}

function normalizeSerial(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || isPlaceholder(trimmed)) return null;
  return trimmed.toUpperCase();
}

function orderedPair(a: string, b: string): { a: string; b: string } | null {
  if (a === b) return null;
  return a < b ? { a, b } : { a: b, b: a };
}

type Index = Map<string, Set<string>>;

function addIndex(index: Index, key: string | null, assetUuid: string) {
  if (!key) return;
  const set = index.get(key) ?? new Set<string>();
  set.add(assetUuid);
  index.set(key, set);
}

export function generateDuplicateCandidatesForRunAssets(args: {
  assetType: DupRulesV1AssetType;
  runAssets: CandidateAssetInput[];
  pool: CandidateAssetInput[];
}): DuplicateCandidateDraft[] {
  const normalizedByUuid = new Map<string, unknown>();
  for (const item of args.pool) normalizedByUuid.set(item.assetUuid, item.normalized);

  const machineUuidIndex: Index = new Map();
  const macIndex: Index = new Map();
  const hostnameIpIndex: Index = new Map();
  const serialIndex: Index = new Map();
  const bmcIpIndex: Index = new Map();
  const mgmtIpIndex: Index = new Map();

  for (const item of args.pool) {
    const n = item.normalized;

    if (args.assetType === 'vm') {
      addIndex(machineUuidIndex, normalizeUuid(getNested(n, ['identity', 'machine_uuid'])), item.assetUuid);

      const macs = normalizeMacs(getNested(n, ['network', 'mac_addresses']));
      for (const mac of macs) addIndex(macIndex, mac, item.assetUuid);

      const hostname = normalizeHostname(getNested(n, ['identity', 'hostname']));
      const ips = normalizeIps(getNested(n, ['network', 'ip_addresses']));
      if (hostname) {
        for (const ip of ips) addIndex(hostnameIpIndex, `${hostname}|${ip}`, item.assetUuid);
      }
    }

    if (args.assetType === 'host') {
      addIndex(serialIndex, normalizeSerial(getNested(n, ['identity', 'serial_number'])), item.assetUuid);
      addIndex(bmcIpIndex, normalizeIp(getNested(n, ['network', 'bmc_ip'])), item.assetUuid);
      addIndex(mgmtIpIndex, normalizeIp(getNested(n, ['network', 'management_ip'])), item.assetUuid);
    }
  }

  const pairKeys = new Set<string>();
  const pairs: Array<{ a: string; b: string }> = [];

  const collectMatches = (runAssetUuid: string, candidates: Iterable<string>) => {
    for (const otherUuid of candidates) {
      const pair = orderedPair(runAssetUuid, otherUuid);
      if (!pair) continue;
      const key = `${pair.a}|${pair.b}`;
      if (pairKeys.has(key)) continue;
      pairKeys.add(key);
      pairs.push(pair);
    }
  };

  for (const runAsset of args.runAssets) {
    const n = runAsset.normalized;

    if (args.assetType === 'vm') {
      const uuid = normalizeUuid(getNested(n, ['identity', 'machine_uuid']));
      if (uuid) collectMatches(runAsset.assetUuid, machineUuidIndex.get(uuid) ?? []);

      const macs = normalizeMacs(getNested(n, ['network', 'mac_addresses']));
      for (const mac of macs) collectMatches(runAsset.assetUuid, macIndex.get(mac) ?? []);

      const hostname = normalizeHostname(getNested(n, ['identity', 'hostname']));
      const ips = normalizeIps(getNested(n, ['network', 'ip_addresses']));
      if (hostname) {
        for (const ip of ips) collectMatches(runAsset.assetUuid, hostnameIpIndex.get(`${hostname}|${ip}`) ?? []);
      }
    }

    if (args.assetType === 'host') {
      const sn = normalizeSerial(getNested(n, ['identity', 'serial_number']));
      if (sn) collectMatches(runAsset.assetUuid, serialIndex.get(sn) ?? []);

      const bmc = normalizeIp(getNested(n, ['network', 'bmc_ip']));
      if (bmc) collectMatches(runAsset.assetUuid, bmcIpIndex.get(bmc) ?? []);

      const mgmt = normalizeIp(getNested(n, ['network', 'management_ip']));
      if (mgmt) collectMatches(runAsset.assetUuid, mgmtIpIndex.get(mgmt) ?? []);
    }
  }

  const out: DuplicateCandidateDraft[] = [];

  for (const pair of pairs) {
    const aNorm = normalizedByUuid.get(pair.a);
    const bNorm = normalizedByUuid.get(pair.b);
    if (!aNorm || !bNorm) continue;

    const scored = calculateDupScoreV1(aNorm, bNorm, args.assetType);
    if (scored.score < 70) continue;

    out.push({ assetUuidA: pair.a, assetUuidB: pair.b, score: scored.score, reasons: scored.reasons });
  }

  return out;
}
