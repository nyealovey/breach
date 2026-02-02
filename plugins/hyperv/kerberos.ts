type BuildKerberosPrincipalCandidatesInput = {
  rawUsername: string;
  domain?: string;
  realmFromHost: string | null;
};

export type BuildKinitArgsInput = {
  principal: string;
  passwordFilePath: string;
  enterprise?: boolean;
};

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function normalizeDomain(domain: string | undefined): string {
  if (typeof domain !== 'string') return '';
  return domain.trim();
}

function normalizeRealm(realm: string | null): string {
  if (typeof realm !== 'string') return '';
  return realm.trim().toUpperCase();
}

export function buildKerberosPrincipalCandidates(input: BuildKerberosPrincipalCandidatesInput): string[] {
  const rawUsername = input.rawUsername.trim();
  if (!rawUsername) return [];

  // UPN / enterprise principal: keep as-is first, and try uppercasing the realm portion too.
  if (rawUsername.includes('@')) {
    const [userPart, realmPart] = rawUsername.split('@');
    if (!userPart || !realmPart) return [rawUsername];
    const upper = `${userPart}@${realmPart.toUpperCase()}`;
    return uniq([rawUsername, upper]);
  }

  const domain = normalizeDomain(input.domain);
  const hostRealm = normalizeRealm(input.realmFromHost);
  const realms: string[] = [];

  // 1) If domain looks like a DNS domain, treat it as realm.
  if (domain && domain.includes('.')) realms.push(domain.toUpperCase());

  // 2) If domain is NetBIOS-ish and we have host realm, try "<DOMAIN>.<HOST_REALM>" first.
  if (domain && !domain.includes('.') && hostRealm) realms.push(`${domain.toUpperCase()}.${hostRealm}`);

  // 3) Host realm (derived from endpoint FQDN/PTR) is a good default.
  if (hostRealm) realms.push(hostRealm);

  // No realm = cannot construct a principal reliably.
  if (realms.length === 0) return [];

  return uniq(realms.map((r) => `${rawUsername}@${r}`));
}

export function buildKinitArgs(input: BuildKinitArgsInput): string[] {
  const principal = input.principal.trim();
  const passwordFilePath = input.passwordFilePath.trim();
  if (!principal) return [];
  if (!passwordFilePath) return [];

  // Use --password-file to avoid interactive TTY prompts (macOS kinit defaults to TTY).
  // macOS Heimdal `kinit` requires the `--password-file=<path>` form (space-separated prints usage).
  return [...(input.enterprise ? ['--enterprise'] : []), `--password-file=${passwordFilePath}`, principal];
}
