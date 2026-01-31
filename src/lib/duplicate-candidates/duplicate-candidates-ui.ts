import type { BadgeProps } from '@/components/ui/badge';

export type DuplicateCandidateConfidence = 'High' | 'Medium';
export type DuplicateCandidateStatus = 'open' | 'ignored' | 'merged';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

export function confidenceLabel(score: number): DuplicateCandidateConfidence {
  return score >= 90 ? 'High' : 'Medium';
}

export function candidateStatusLabel(status: DuplicateCandidateStatus): string {
  if (status === 'open') return '待处理';
  if (status === 'ignored') return '已忽略';
  return '已合并';
}

export function confidenceBadgeVariant(confidence: DuplicateCandidateConfidence): BadgeVariant {
  if (confidence === 'High') return 'default';
  return 'secondary';
}
