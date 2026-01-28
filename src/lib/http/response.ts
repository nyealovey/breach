import { NextResponse } from 'next/server';

import { getOrCreateRequestId } from '@/lib/http/request-id';

import type { AppError } from '@/lib/errors/error';

export type ResponseMeta = {
  requestId: string;
  timestamp: string;
};

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ResponseOptions = {
  requestId?: string;
  init?: ResponseInit;
};

function withRequestIdHeaders(requestId: string, init?: ResponseInit): ResponseInit {
  const headers = new Headers(init?.headers);
  headers.set('X-Request-ID', requestId);
  return { ...init, headers };
}

function buildMeta(requestId?: string): ResponseMeta {
  return { requestId: getOrCreateRequestId(requestId), timestamp: new Date().toISOString() };
}

export function ok<T>(data: T, options: ResponseOptions = {}) {
  const meta = buildMeta(options.requestId);
  const init = withRequestIdHeaders(meta.requestId, options.init);
  return NextResponse.json({ data, meta }, { ...init, status: 200 });
}

export function okPaginated<T>(data: T[], pagination: Pagination, options: ResponseOptions = {}) {
  const meta = buildMeta(options.requestId);
  const init = withRequestIdHeaders(meta.requestId, options.init);
  return NextResponse.json({ data, pagination, meta }, { ...init, status: 200 });
}

export function created<T>(data: T, options: ResponseOptions = {}) {
  const meta = buildMeta(options.requestId);
  const init = withRequestIdHeaders(meta.requestId, options.init);
  return NextResponse.json({ data, meta }, { ...init, status: 201 });
}

export function fail(error: AppError, status: number, options: ResponseOptions = {}) {
  const meta = buildMeta(options.requestId);
  const init = withRequestIdHeaders(meta.requestId, options.init);
  return NextResponse.json({ error, meta }, { ...init, status });
}
