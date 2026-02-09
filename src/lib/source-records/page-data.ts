import type { SourceRecordNormalizedResult, SourceRecordRawResult } from '@/lib/actions/source-records';

export type SourceRecordTab = 'normalized' | 'raw';

export type SourceRecordPageInitialData = {
  recordId: string;
  isAdmin: boolean;
  tab: SourceRecordTab;
  normalized: SourceRecordNormalizedResult | null;
  raw: SourceRecordRawResult | null;
  loadError: string | null;
};

export function parseSourceRecordTab(raw: string | null, isAdmin: boolean): SourceRecordTab {
  if (raw === 'raw' && isAdmin) return 'raw';
  return 'normalized';
}
