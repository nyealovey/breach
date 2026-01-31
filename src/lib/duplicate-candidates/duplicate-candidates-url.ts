import { parsePagination } from '@/lib/http/pagination';

export type DuplicateCandidateStatusParam = 'open' | 'ignored' | 'merged';
export type DuplicateCandidateAssetTypeParam = 'vm' | 'host';
export type DuplicateCandidateConfidenceParam = 'High' | 'Medium';

export type DuplicateCandidatesUrlState = {
  status: DuplicateCandidateStatusParam;
  assetType?: DuplicateCandidateAssetTypeParam;
  confidence?: DuplicateCandidateConfidenceParam;
  page: number;
  pageSize: number;
};

const DEFAULT_STATUS: DuplicateCandidateStatusParam = 'open';
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const;

function parseStatus(input: string | null): DuplicateCandidateStatusParam | undefined {
  if (input === 'open' || input === 'ignored' || input === 'merged') return input;
  return undefined;
}

function parseAssetType(input: string | null): DuplicateCandidateAssetTypeParam | undefined {
  if (input === 'vm' || input === 'host') return input;
  return undefined;
}

function parseConfidence(input: string | null): DuplicateCandidateConfidenceParam | undefined {
  if (input === 'High' || input === 'Medium') return input;
  return undefined;
}

function normalizePageSize(pageSize: number): number {
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
}

export function parseDuplicateCandidatesUrlState(params: URLSearchParams): DuplicateCandidatesUrlState {
  const { page, pageSize } = parsePagination(params, { page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE });

  return {
    status: parseStatus(params.get('status')) ?? DEFAULT_STATUS,
    assetType: parseAssetType(params.get('assetType')),
    confidence: parseConfidence(params.get('confidence')),
    page,
    pageSize: normalizePageSize(pageSize),
  };
}

export function buildDuplicateCandidatesUrlSearchParams(state: DuplicateCandidatesUrlState): URLSearchParams {
  const params = new URLSearchParams();

  if (state.assetType) params.set('assetType', state.assetType);
  if (state.confidence) params.set('confidence', state.confidence);

  if (state.status !== DEFAULT_STATUS) params.set('status', state.status);

  const page = Number.isFinite(state.page) && state.page > 0 ? Math.floor(state.page) : DEFAULT_PAGE;
  const pageSize = normalizePageSize(
    Number.isFinite(state.pageSize) && state.pageSize > 0 ? Math.floor(state.pageSize) : DEFAULT_PAGE_SIZE,
  );

  if (page !== DEFAULT_PAGE) params.set('page', String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize));

  return params;
}
