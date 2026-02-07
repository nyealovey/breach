#!/usr/bin/env bun

import { Client } from 'ldapts';

type CollectorError = {
  code: string;
  category: string;
  message: string;
  retryable: boolean;
  redacted_context?: Record<string, unknown>;
};

type CollectorRequest = {
  schema_version: 'collector-request-v1';
  source?: {
    source_id?: string;
    source_type?: string;
    config?: Record<string, unknown>;
    credential?: Record<string, unknown>;
  };
  request?: {
    run_id?: string;
    mode?: 'detect' | 'collect' | 'healthcheck' | string;
    now?: string;
  };
};

type CollectorResponse = {
  schema_version: 'collector-response-v1';
  detect?: {
    target_version: string;
    capabilities: Record<string, unknown>;
    driver: string;
  };
  assets: unknown[];
  relations: unknown[];
  directory?: {
    domains: Array<Record<string, unknown>>;
    users: Array<Record<string, unknown>>;
  };
  stats: {
    assets: number;
    relations: number;
    inventory_complete: boolean;
    warnings: unknown[];
  };
  errors: CollectorError[];
};

function makeResponse(partial: Partial<CollectorResponse>): CollectorResponse {
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

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringAttribute(entry: Record<string, unknown>, key: string): string | null {
  const value = entry[key];
  if (typeof value === 'string') return cleanString(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        const cleaned = cleanString(item);
        if (cleaned) return cleaned;
      }
    }
  }
  return null;
}

function readObjectGuid(entry: Record<string, unknown>): string | null {
  const value = entry.objectGUID;
  if (typeof value === 'string') return cleanString(value);
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        const cleaned = cleanString(item);
        if (cleaned) return cleaned;
      }
      if (Buffer.isBuffer(item)) return item.toString('hex');
    }
  }
  return null;
}

function parseEnabled(entry: Record<string, unknown>): boolean | null {
  const raw = entry.userAccountControl;
  const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
    return null;
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const n = toNumber(item);
      if (n !== null) return (n & 2) === 0;
    }
  }

  const num = toNumber(raw);
  if (num === null) return null;
  return (num & 2) === 0;
}

function parseTimeoutMs(config: Record<string, unknown>): number {
  const value = config.timeout_ms;
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
  return 60_000;
}

function parseTlsVerify(config: Record<string, unknown>): boolean {
  return typeof config.tls_verify === 'boolean' ? config.tls_verify : true;
}

function buildUserFilter(upn?: string | null, customFilter?: string | null): string {
  const base = upn
    ? `(&(objectClass=user)(!(objectClass=computer))(userPrincipalName=${upn}))`
    : '(&(objectClass=user)(!(objectClass=computer)))';
  const extra = customFilter?.trim();
  if (!extra) return base;
  const wrapped = extra.startsWith('(') && extra.endsWith(')') ? extra : `(${extra})`;
  return `(&${base}${wrapped})`;
}

async function main() {
  let request: CollectorRequest;
  try {
    request = (await readStdinJson()) as CollectorRequest;
  } catch (error) {
    const response = makeResponse({
      errors: [
        {
          code: 'AD_PARSE_ERROR',
          category: 'parse',
          message: 'invalid request json',
          retryable: false,
          redacted_context: { cause: error instanceof Error ? error.message : String(error) },
        },
      ],
    });
    process.stdout.write(JSON.stringify(response));
    process.exit(1);
  }

  const source = request.source ?? {};
  const config = source.config ?? {};
  const credential = source.credential ?? {};
  const mode = request.request?.mode ?? 'detect';

  const serverUrl = cleanString(config.server_url) ?? cleanString(config.endpoint);
  const baseDn = cleanString(config.base_dn);
  const bindUpn = cleanString(credential.bindUpn);
  const bindPassword = cleanString(credential.bindPassword);

  if (!serverUrl || !baseDn || !bindUpn || !bindPassword) {
    const response = makeResponse({
      errors: [
        {
          code: 'AD_CONFIG_INVALID',
          category: 'config',
          message: 'missing ad config or credential',
          retryable: false,
        },
      ],
      stats: { assets: 0, relations: 0, inventory_complete: false, warnings: [] },
    });
    process.stdout.write(JSON.stringify(response));
    process.exit(1);
  }

  const timeoutMs = parseTimeoutMs(config);
  const tlsVerify = parseTlsVerify(config);
  const client = new Client({
    url: serverUrl,
    timeout: timeoutMs,
    connectTimeout: timeoutMs,
    tlsOptions: { rejectUnauthorized: tlsVerify },
  });

  const warnings: unknown[] = [];

  try {
    await client.bind(bindUpn, bindPassword);

    if (mode === 'detect') {
      const response = makeResponse({
        detect: {
          target_version: 'ad',
          capabilities: {
            collect_modes: ['collect', 'healthcheck'],
            schema: 'directory-v1',
          },
          driver: 'activedirectory-ldap@v1',
        },
        stats: { assets: 0, relations: 0, inventory_complete: true, warnings },
      });
      process.stdout.write(JSON.stringify(response));
      process.exit(0);
    }

    if (mode === 'healthcheck') {
      const response = makeResponse({
        stats: { assets: 0, relations: 0, inventory_complete: true, warnings },
      });
      process.stdout.write(JSON.stringify(response));
      process.exit(0);
    }

    if (mode !== 'collect') {
      const response = makeResponse({
        errors: [
          {
            code: 'AD_CONFIG_INVALID',
            category: 'config',
            message: `unsupported mode: ${mode}`,
            retryable: false,
          },
        ],
      });
      process.stdout.write(JSON.stringify(response));
      process.exit(1);
    }

    const domainSearch = await client.search(baseDn, {
      scope: 'base',
      filter: '(objectClass=*)',
      attributes: ['distinguishedName', 'dnsRoot', 'nETBIOSName', 'objectGUID'],
      sizeLimit: 1,
      paged: false,
    });

    const domainEntry = (domainSearch.searchEntries[0] ?? {}) as Record<string, unknown>;
    const domains = [
      {
        domain_dn: readStringAttribute(domainEntry, 'distinguishedName') ?? baseDn,
        dns_root: readStringAttribute(domainEntry, 'dnsRoot'),
        netbios_name: readStringAttribute(domainEntry, 'nETBIOSName'),
        object_guid: readObjectGuid(domainEntry),
        raw_payload: domainEntry,
      },
    ];

    const userFilter = buildUserFilter(null, cleanString(config.user_filter));
    const userSearch = await client.search(baseDn, {
      scope: 'sub',
      filter: userFilter,
      attributes: [
        'distinguishedName',
        'userPrincipalName',
        'sAMAccountName',
        'displayName',
        'mail',
        'objectGUID',
        'userAccountControl',
      ],
      paged: true,
      sizeLimit: 0,
    });

    const users = userSearch.searchEntries.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        object_guid: readObjectGuid(row),
        dn: readStringAttribute(row, 'distinguishedName'),
        upn: readStringAttribute(row, 'userPrincipalName'),
        sam_account_name: readStringAttribute(row, 'sAMAccountName'),
        display_name: readStringAttribute(row, 'displayName'),
        mail: readStringAttribute(row, 'mail'),
        enabled: parseEnabled(row),
        raw_payload: row,
      };
    });

    const response = makeResponse({
      directory: { domains, users },
      stats: {
        assets: 0,
        relations: 0,
        inventory_complete: true,
        warnings,
      },
    });
    process.stdout.write(JSON.stringify(response));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const authError = lower.includes('invalid credentials') || lower.includes('49');

    const response = makeResponse({
      errors: [
        {
          code: authError ? 'AD_AUTH_FAILED' : 'AD_NETWORK_ERROR',
          category: authError ? 'auth' : 'network',
          message: authError ? 'authentication failed' : 'ldap request failed',
          retryable: !authError,
          redacted_context: { cause: message.slice(0, 500) },
        },
      ],
      stats: {
        assets: 0,
        relations: 0,
        inventory_complete: false,
        warnings,
      },
    });
    process.stdout.write(JSON.stringify(response));
    process.exit(1);
  } finally {
    try {
      await client.unbind();
    } catch {
      // Ignore unbind errors.
    }
  }
}

void main();
