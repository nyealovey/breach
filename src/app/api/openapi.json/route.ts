import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { getOpenApiSpec } from '@/lib/openapi/spec';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const spec = getOpenApiSpec();
  const res = NextResponse.json(spec);

  if (auth.requestId) res.headers.set('X-Request-ID', auth.requestId);
  return res;
}
