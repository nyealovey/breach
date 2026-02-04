import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/db/prisma';
import { ErrorCode } from '@/lib/errors/error-codes';
import { fail, ok } from '@/lib/http/response';

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
  return fallback;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) {
    return fail(
      { code: ErrorCode.CONFIG_AGENT_NOT_FOUND, category: 'config', message: 'Agent not found', retryable: false },
      404,
      { requestId: auth.requestId },
    );
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutMs = clampPositiveInt(agent.timeoutMs, 60_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let reachable = false;
  let status: number | null = null;
  let error: string | null = null;

  try {
    const url = new URL('/health', agent.endpoint).toString();
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    status = res.status;
    reachable = res.ok;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      error = text ? text.slice(0, 500) : `status=${res.status}`;
    }
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    error = cause;
  } finally {
    clearTimeout(timeout);
  }

  const durationMs = Date.now() - startedAt;

  return ok(
    {
      agentId: agent.id,
      reachable,
      status,
      durationMs,
      error,
    },
    { requestId: auth.requestId },
  );
}
