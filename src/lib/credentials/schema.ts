import { z } from 'zod/v4';

import { SourceType } from '@prisma/client';

const VcenterPayload = z.object({ username: z.string().min(1), password: z.string().min(1) }).strict();
const HypervWinrmPayloadV2 = z
  .object({
    auth: z.literal('winrm'),
    domain: z.string().min(1).optional(),
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();
const HypervAgentPayloadV2 = z.object({ auth: z.literal('agent'), token: z.string().min(1) }).strict();
// Back-compat: 旧版 Hyper-V credential 只有 domain/username/password。
const HypervWinrmPayloadLegacy = z
  .object({ domain: z.string().min(1).optional(), username: z.string().min(1), password: z.string().min(1) })
  .strict()
  .transform((v) => ({ auth: 'winrm' as const, ...v }));

const HypervPayload = z.union([HypervWinrmPayloadV2, HypervAgentPayloadV2, HypervWinrmPayloadLegacy]);
const PveApiTokenPayload = z.object({
  auth_type: z.literal('api_token'),
  api_token_id: z.string().min(1),
  api_token_secret: z.string().min(1),
});
const PveUserPasswordPayload = z
  .object({
    // Back-compat: allow omitting auth_type (old schema treated PVE as username/password).
    auth_type: z.literal('user_password').optional(),
    username: z.string().min(1),
    password: z.string().min(1),
    // PVE UI 里“认证域/realm”的值（pam/pve/ldap/...）。当 username 已包含 @realm 时可忽略。
    realm: z.string().min(1).optional(),
  })
  .transform((v) => ({
    auth_type: 'user_password' as const,
    username: v.username,
    password: v.password,
    ...(v.realm ? { realm: v.realm } : {}),
  }));
const PvePayload = z.union([PveApiTokenPayload, PveUserPasswordPayload]);
const AliyunPayload = z.object({ accessKeyId: z.string().min(1), accessKeySecret: z.string().min(1) });
const ThirdPartyPayload = z.object({ token: z.string().min(1) });

export const CredentialTypeSchema = z.nativeEnum(SourceType);

export const CredentialCreateSchema = z.object({
  name: z.string().min(1),
  type: CredentialTypeSchema,
  payload: z.union([VcenterPayload, HypervPayload, PvePayload, AliyunPayload, ThirdPartyPayload]),
});

export const CredentialUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  // 允许“更新密钥/密码”：不回显旧 secret，仅覆盖写入
  payload: z.unknown().optional(),
});

export function payloadSchemaByType(type: SourceType) {
  if (type === 'pve') return PvePayload;
  if (type === 'hyperv') return HypervPayload;
  if (type === 'aliyun') return AliyunPayload;
  if (type === 'third_party') return ThirdPartyPayload;
  // vcenter：username/password
  return VcenterPayload;
}
