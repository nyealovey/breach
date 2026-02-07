import { decryptJson } from '@/lib/crypto/aes-gcm';
import { payloadSchemaByType } from '@/lib/credentials/schema';
import { SourceType } from '@prisma/client';

function cleanString(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function maskSecret(input: string): string {
  const value = input.trim();
  if (value.length <= 6) return '***';
  if (value.length <= 12) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function deriveCredentialAccount(type: SourceType, payload: unknown): string | null {
  const parsed = payloadSchemaByType(type).safeParse(payload);
  if (!parsed.success) return null;

  const data = parsed.data as any;

  if (type === SourceType.vcenter) return cleanString(data?.username);
  if (type === SourceType.veeam) return cleanString(data?.username);
  if (type === SourceType.solarwinds) return cleanString(data?.username);

  if (type === SourceType.hyperv) {
    const auth = cleanString(data?.auth);
    if (auth === 'agent') return 'agent-token';

    const username = cleanString(data?.username);
    const domain = cleanString(data?.domain);
    if (!username) return null;
    return domain ? `${domain}\\${username}` : username;
  }

  if (type === SourceType.pve) {
    const authType = cleanString(data?.auth_type);
    if (authType === 'api_token') return cleanString(data?.api_token_id);
    const username = cleanString(data?.username);
    if (!username) return null;
    if (username.includes('@')) return username;
    const realm = cleanString(data?.realm) ?? 'pam';
    return `${username}@${realm}`;
  }

  if (type === SourceType.aliyun) return cleanString(data?.accessKeyId);

  if (type === SourceType.third_party) {
    const token = cleanString(data?.token);
    return token ? maskSecret(token) : null;
  }

  if (type === SourceType.activedirectory) return cleanString(data?.bindUpn);

  return null;
}

export function deriveCredentialAccountFromCiphertext(type: SourceType, payloadCiphertext: string): string | null {
  try {
    const payload = decryptJson<unknown>(payloadCiphertext);
    return deriveCredentialAccount(type, payload);
  } catch {
    return null;
  }
}
