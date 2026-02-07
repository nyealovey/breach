import { Client } from 'ldapts';

export type LdapAuthConfig = {
  serverUrl: string;
  baseDn: string;
  bindUpn: string;
  bindPassword: string;
  tlsVerify: boolean;
  timeoutMs: number;
  userFilter?: string;
};

function escapeLdapFilter(input: string): string {
  return input
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .split('\0')
    .join('\\00');
}

function ensureWrappedFilter(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '(objectClass=*)';
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed;
  return `(${trimmed})`;
}

function buildUserSearchFilter(upn: string, customFilter?: string): string {
  const base = `(&(objectClass=user)(!(objectClass=computer))(userPrincipalName=${escapeLdapFilter(upn)}))`;
  const custom = typeof customFilter === 'string' ? customFilter.trim() : '';
  if (!custom) return base;
  return `(&${base}${ensureWrappedFilter(custom)})`;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
  return fallback;
}

function pickDn(entry: Record<string, unknown>): string | null {
  const byDn = typeof entry.dn === 'string' ? entry.dn.trim() : '';
  if (byDn) return byDn;

  const byDistinguishedName = typeof entry.distinguishedName === 'string' ? entry.distinguishedName.trim() : '';
  if (byDistinguishedName) return byDistinguishedName;

  return null;
}

export function parseLdapAuthConfig(input: {
  config: Record<string, unknown>;
  credential: Record<string, unknown>;
}): LdapAuthConfig | null {
  const serverUrlRaw = typeof input.config.server_url === 'string' ? input.config.server_url.trim() : '';
  const endpointRaw = typeof input.config.endpoint === 'string' ? input.config.endpoint.trim() : '';
  const serverUrl = serverUrlRaw || endpointRaw;

  const baseDn = typeof input.config.base_dn === 'string' ? input.config.base_dn.trim() : '';
  const bindUpn = typeof input.credential.bindUpn === 'string' ? input.credential.bindUpn.trim() : '';
  const bindPassword = typeof input.credential.bindPassword === 'string' ? input.credential.bindPassword : '';

  if (!serverUrl || !baseDn || !bindUpn || !bindPassword) return null;

  return {
    serverUrl,
    baseDn,
    bindUpn,
    bindPassword,
    tlsVerify: toBoolean(input.config.tls_verify, true),
    timeoutMs: toPositiveInt(input.config.timeout_ms, 60_000),
    userFilter: typeof input.config.user_filter === 'string' ? input.config.user_filter.trim() : undefined,
  };
}

export async function verifyLdapPassword(args: {
  upn: string;
  password: string;
  config: LdapAuthConfig;
}): Promise<{ ok: true } | { ok: false; reason: 'invalid_credentials' | 'config_error' | 'server_error' }> {
  const password = args.password;
  if (!password) return { ok: false, reason: 'invalid_credentials' };

  const client = new Client({
    url: args.config.serverUrl,
    timeout: args.config.timeoutMs,
    connectTimeout: args.config.timeoutMs,
    tlsOptions: { rejectUnauthorized: args.config.tlsVerify },
  });

  try {
    await client.bind(args.config.bindUpn, args.config.bindPassword);

    const filter = buildUserSearchFilter(args.upn, args.config.userFilter);
    const search = await client.search(args.config.baseDn, {
      scope: 'sub',
      filter,
      attributes: ['distinguishedName', 'userPrincipalName'],
      sizeLimit: 2,
      paged: false,
    });

    const first = search.searchEntries[0] as Record<string, unknown> | undefined;
    if (!first) return { ok: false, reason: 'invalid_credentials' };

    const userDn = pickDn(first);
    if (!userDn) return { ok: false, reason: 'config_error' };

    await client.bind(userDn, password);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('invalid credentials')) return { ok: false, reason: 'invalid_credentials' };
    if (
      message.includes('no such object') ||
      message.includes('invalid dn syntax') ||
      message.includes('protocol error')
    ) {
      return { ok: false, reason: 'config_error' };
    }
    return { ok: false, reason: 'server_error' };
  } finally {
    try {
      await client.unbind();
    } catch {
      // Ignore unbind errors.
    }
  }
}
