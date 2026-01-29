import { SourceType } from '@prisma/client';
import { z } from 'zod/v4';

const VcenterPayload = z.object({ username: z.string().min(1), password: z.string().min(1) });
const AliyunPayload = z.object({ accessKeyId: z.string().min(1), accessKeySecret: z.string().min(1) });
const ThirdPartyPayload = z.object({ token: z.string().min(1) });

export const CredentialTypeSchema = z.nativeEnum(SourceType);

export const CredentialCreateSchema = z.object({
  name: z.string().min(1),
  type: CredentialTypeSchema,
  payload: z.union([
    VcenterPayload, // vcenter/pve/hyperv 复用同结构
    AliyunPayload,
    ThirdPartyPayload,
  ]),
});

export const CredentialUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  // 允许“更新密钥/密码”：不回显旧 secret，仅覆盖写入
  payload: z.unknown().optional(),
});

export function payloadSchemaByType(type: SourceType) {
  if (type === 'aliyun') return AliyunPayload;
  if (type === 'third_party') return ThirdPartyPayload;
  // vcenter/pve/hyperv：username/password
  return VcenterPayload;
}

