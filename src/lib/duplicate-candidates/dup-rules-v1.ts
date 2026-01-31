export type DupRulesV1AssetType = 'vm' | 'host';

export type DupRulesV1Match = {
  code:
    | 'vm.machine_uuid_match'
    | 'vm.mac_overlap'
    | 'vm.hostname_ip_overlap'
    | 'host.serial_match'
    | 'host.bmc_ip_match'
    | 'host.mgmt_ip_match';
  weight: number;
  evidence: {
    field: string;
    a: unknown;
    b: unknown;
  };
};

const PLACEHOLDER_BLACKLIST = new Set(
  [
    // Generic
    'n/a',
    'na',
    'unknown',
    'none',
    'null',
    '-',
    '--',
    '---',
    '0',

    // UUID placeholders (raw + compact)
    '00000000-0000-0000-0000-000000000000',
    '00000000000000000000000000000000',

    // Serial placeholders
    'to be filled',
    'to be filled by o.e.m.',
    'default string',
    'system serial number',
    'not specified',
    'not available',
    'xxxxxxxxxx',
    'xxxxxxxxxxxx',

    // MAC placeholders (raw + compact)
    '00:00:00:00:00:00',
    'ff:ff:ff:ff:ff:ff',
    '00-00-00-00-00-00',
    'ff-ff-ff-ff-ff-ff',
    '000000000000',
    'ffffffffffff',
  ].map((v) => v.trim().toLowerCase()),
);

function placeholderKey(value: string) {
  return value.trim().toLowerCase();
}

function placeholderCompactKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-:\s]/g, '');
}

function isPlaceholder(value: string) {
  if (PLACEHOLDER_BLACKLIST.has(placeholderKey(value))) return true;
  if (PLACEHOLDER_BLACKLIST.has(placeholderCompactKey(value))) return true;
  return false;
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim() === '') return null;
  if (isPlaceholder(value)) return null;
  const compact = value.trim().toLowerCase().replace(/-/g, '');
  if (compact === '' || isPlaceholder(compact)) return null;
  return compact;
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

function getNested(obj: unknown, path: Array<string>): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  let cur: any = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function calculateDupScoreV1(
  a: unknown,
  b: unknown,
  assetType: DupRulesV1AssetType,
): { score: number; reasons: DupRulesV1Match[] } {
  const reasons: DupRulesV1Match[] = [];
  let score = 0;

  const push = (match: DupRulesV1Match | null) => {
    if (!match) return;
    reasons.push(match);
    score += match.weight;
  };

  if (assetType === 'vm') {
    const uuidA = normalizeUuid(getNested(a, ['identity', 'machine_uuid']));
    const uuidB = normalizeUuid(getNested(b, ['identity', 'machine_uuid']));
    if (uuidA && uuidB && uuidA === uuidB) {
      push({
        code: 'vm.machine_uuid_match',
        weight: 100,
        evidence: {
          field: 'normalized.identity.machine_uuid',
          a: getNested(a, ['identity', 'machine_uuid']),
          b: getNested(b, ['identity', 'machine_uuid']),
        },
      });
    }

    const macsA = normalizeMacs(getNested(a, ['network', 'mac_addresses']));
    const macsB = normalizeMacs(getNested(b, ['network', 'mac_addresses']));
    if (macsA.length > 0 && macsB.length > 0) {
      const overlap = macsA.filter((m) => macsB.includes(m));
      if (overlap.length > 0) {
        push({
          code: 'vm.mac_overlap',
          weight: 90,
          evidence: {
            field: 'normalized.network.mac_addresses',
            a: getNested(a, ['network', 'mac_addresses']),
            b: getNested(b, ['network', 'mac_addresses']),
          },
        });
      }
    }

    const hostnameA = normalizeHostname(getNested(a, ['identity', 'hostname']));
    const hostnameB = normalizeHostname(getNested(b, ['identity', 'hostname']));
    if (hostnameA && hostnameB && hostnameA === hostnameB) {
      const ipsA = normalizeIps(getNested(a, ['network', 'ip_addresses']));
      const ipsB = normalizeIps(getNested(b, ['network', 'ip_addresses']));
      if (ipsA.length > 0 && ipsB.length > 0) {
        const overlap = ipsA.filter((ip) => ipsB.includes(ip));
        if (overlap.length > 0) {
          push({
            code: 'vm.hostname_ip_overlap',
            weight: 70,
            evidence: {
              field: 'normalized.identity.hostname + normalized.network.ip_addresses',
              a: { hostname: getNested(a, ['identity', 'hostname']), ips: getNested(a, ['network', 'ip_addresses']) },
              b: { hostname: getNested(b, ['identity', 'hostname']), ips: getNested(b, ['network', 'ip_addresses']) },
            },
          });
        }
      }
    }
  }

  if (assetType === 'host') {
    const snA = normalizeSerial(getNested(a, ['identity', 'serial_number']));
    const snB = normalizeSerial(getNested(b, ['identity', 'serial_number']));
    if (snA && snB && snA === snB) {
      push({
        code: 'host.serial_match',
        weight: 100,
        evidence: {
          field: 'normalized.identity.serial_number',
          a: getNested(a, ['identity', 'serial_number']),
          b: getNested(b, ['identity', 'serial_number']),
        },
      });
    }

    const bmcA = normalizeIp(getNested(a, ['network', 'bmc_ip']));
    const bmcB = normalizeIp(getNested(b, ['network', 'bmc_ip']));
    if (bmcA && bmcB && bmcA === bmcB) {
      push({
        code: 'host.bmc_ip_match',
        weight: 90,
        evidence: {
          field: 'normalized.network.bmc_ip',
          a: getNested(a, ['network', 'bmc_ip']),
          b: getNested(b, ['network', 'bmc_ip']),
        },
      });
    }

    const mgmtA = normalizeIp(getNested(a, ['network', 'management_ip']));
    const mgmtB = normalizeIp(getNested(b, ['network', 'management_ip']));
    if (mgmtA && mgmtB && mgmtA === mgmtB) {
      push({
        code: 'host.mgmt_ip_match',
        weight: 70,
        evidence: {
          field: 'normalized.network.management_ip',
          a: getNested(a, ['network', 'management_ip']),
          b: getNested(b, ['network', 'management_ip']),
        },
      });
    }
  }

  return { score: Math.min(score, 100), reasons };
}
