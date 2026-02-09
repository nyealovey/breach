'use server';

import { actionError, actionOk, getActionErrorMessage } from '@/lib/actions/action-result';
import { buildInternalRequest, readInternalErrorMessage } from '@/lib/actions/internal-api';
import { listAgents } from '@/app/agents/actions';
import { listCredentials } from '@/app/credentials/actions';
import { GET as sourcesGet, POST as sourcesPost } from '@/app/api/v1/sources/route';
import { DELETE as sourceDelete, GET as sourceGet, PUT as sourcePut } from '@/app/api/v1/sources/[id]/route';

import type { ActionResult } from '@/lib/actions/action-result';
import type { AgentListItem } from '@/app/agents/actions';
import type { CredentialListItem } from '@/app/credentials/actions';

export type SourceListItem = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  credential: { credentialId: string; name: string; type: string } | null;
  config?: { endpoint?: string } | null;
  lastRun: { runId: string; status: string; finishedAt: string | null; mode: string } | null;
};

export type SourceDetail = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  scheduleGroupId: string | null;
  scheduleGroupName: string | null;
  credential: { credentialId: string; name: string; type: string } | null;
  agent: { agentId: string; name: string; agentType: string } | null;
  config?: Record<string, unknown> | null;
};

export type CredentialOption = { credentialId: string; name: string; type: string };
export type AgentOption = {
  agentId: string;
  name: string;
  agentType: string;
  endpoint: string;
  enabled: boolean;
  tlsVerify: boolean;
  timeoutMs: number;
};

export async function listSources(): Promise<SourceListItem[]> {
  try {
    const req = await buildInternalRequest('http://internal/api/v1/sources?pageSize=200', { method: 'GET' });
    const res = await sourcesGet(req);
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: SourceListItem[] };
    return body.data ?? [];
  } catch {
    return [];
  }
}

export async function getSource(sourceId: string): Promise<SourceDetail | null> {
  const id = sourceId.trim();
  if (!id) return null;

  const req = await buildInternalRequest(`http://internal/api/v1/sources/${encodeURIComponent(id)}`, { method: 'GET' });
  const res = await sourceGet(req, { params: Promise.resolve({ id }) });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: SourceDetail };
  return body.data ?? null;
}

export async function createSourceAction(input: unknown): Promise<ActionResult<SourceDetail>> {
  try {
    const req = await buildInternalRequest('http://internal/api/v1/sources', { method: 'POST', json: input });
    const res = await sourcesPost(req);
    if (!res.ok) return actionError(await readInternalErrorMessage(res, '创建失败'));
    const body = (await res.json()) as { data?: SourceDetail };
    if (!body.data) return actionError('创建失败');
    return actionOk(body.data);
  } catch (err) {
    return actionError(getActionErrorMessage(err, '创建失败'));
  }
}

export async function updateSourceAction(sourceId: string, input: unknown): Promise<ActionResult<SourceDetail>> {
  const id = sourceId.trim();
  if (!id) return actionError('Invalid sourceId');

  try {
    const req = await buildInternalRequest(`http://internal/api/v1/sources/${encodeURIComponent(id)}`, {
      method: 'PUT',
      json: input,
    });
    const res = await sourcePut(req, { params: Promise.resolve({ id }) });
    if (!res.ok) return actionError(await readInternalErrorMessage(res, '更新失败'));
    const body = (await res.json()) as { data?: SourceDetail };
    if (!body.data) return actionError('更新失败');
    return actionOk(body.data);
  } catch (err) {
    return actionError(getActionErrorMessage(err, '更新失败'));
  }
}

export async function deleteSourceAction(sourceId: string): Promise<ActionResult<{ deleted: true }>> {
  const id = sourceId.trim();
  if (!id) return actionError('Invalid sourceId');

  try {
    const req = await buildInternalRequest(`http://internal/api/v1/sources/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const res = await sourceDelete(req, { params: Promise.resolve({ id }) });
    if (res.status === 204) return actionOk({ deleted: true });
    if (!res.ok) return actionError(await readInternalErrorMessage(res, '删除失败'));
    return actionError('删除失败');
  } catch (err) {
    return actionError(getActionErrorMessage(err, '删除失败'));
  }
}

export async function listCredentialOptionsAction(sourceType: string): Promise<ActionResult<CredentialOption[]>> {
  try {
    const items: CredentialListItem[] = await listCredentials({ pageSize: 100, type: sourceType });
    return actionOk(items.map((c) => ({ credentialId: c.credentialId, name: c.name, type: c.type })));
  } catch (err) {
    return actionError(getActionErrorMessage(err, '加载凭据失败'));
  }
}

export async function listHypervAgentOptionsAction(input?: {
  enabled?: boolean;
}): Promise<ActionResult<AgentOption[]>> {
  try {
    const items: AgentListItem[] = await listAgents({
      pageSize: 100,
      enabled: typeof input?.enabled === 'boolean' ? input.enabled : undefined,
      agentType: 'hyperv',
    });
    return actionOk(
      items.map((a) => ({
        agentId: a.agentId,
        name: a.name,
        agentType: a.agentType,
        endpoint: a.endpoint,
        enabled: a.enabled,
        tlsVerify: a.tlsVerify,
        timeoutMs: a.timeoutMs,
      })),
    );
  } catch (err) {
    return actionError(getActionErrorMessage(err, '加载代理失败'));
  }
}
