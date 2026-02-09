import type { RelationChainNode } from '@/lib/assets/asset-relation-chain';
import type { CandidateReason } from '@/lib/duplicate-candidates/candidate-ui-utils';
import type {
  DuplicateCandidateAssetTypeParam,
  DuplicateCandidateConfidenceParam,
  DuplicateCandidateStatusParam,
  DuplicateCandidatesUrlState,
} from '@/lib/duplicate-candidates/duplicate-candidates-url';

export type DuplicateCandidateSourceLink = {
  sourceId: string;
  sourceName: string;
  externalKind: string;
  externalId: string;
  presenceStatus: 'present' | 'missing';
  lastSeenAt: string;
  lastSeenRunId: string | null;
};

export type DuplicateCandidateAsset = {
  assetUuid: string;
  assetType: DuplicateCandidateAssetTypeParam;
  status: string;
  displayName: string | null;
  lastSeenAt: string | null;
  sourceLinks: DuplicateCandidateSourceLink[];
};

export type DuplicateCandidateDetail = {
  candidateId: string;
  status: DuplicateCandidateStatusParam;
  score: number;
  confidence: DuplicateCandidateConfidenceParam;
  reasons: CandidateReason[] | unknown;
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
  ignore: null | {
    ignoredByUserId: string | null;
    ignoredAt: string | null;
    ignoreReason: string | null;
  };
  assetA: DuplicateCandidateAsset;
  assetB: DuplicateCandidateAsset;
};

export type DuplicateCandidateListItem = {
  candidateId: string;
  status: DuplicateCandidateStatusParam;
  score: number;
  confidence: DuplicateCandidateConfidenceParam;
  lastObservedAt: string;
  assetA: {
    assetUuid: string;
    assetType: DuplicateCandidateAssetTypeParam;
    status: string;
    displayName: string | null;
    lastSeenAt: string | null;
  };
  assetB: {
    assetUuid: string;
    assetType: DuplicateCandidateAssetTypeParam;
    status: string;
    displayName: string | null;
    lastSeenAt: string | null;
  };
};

export type DuplicateCandidatesPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type DuplicateCandidatesPageInitialData = {
  urlState: DuplicateCandidatesUrlState;
  queryString: string;
  list: { items: DuplicateCandidateListItem[]; pagination: DuplicateCandidatesPagination } | null;
  loadError: string | null;
};

export type DuplicateCandidatePageInitialData = {
  candidateId: string;
  candidate: DuplicateCandidateDetail | null;
  loadError: string | null;
  canonicalFields: {
    assetA: unknown | null;
    assetB: unknown | null;
    error: string | null;
  };
  vmHosts: {
    assetA: RelationChainNode | null;
    assetB: RelationChainNode | null;
  };
};
