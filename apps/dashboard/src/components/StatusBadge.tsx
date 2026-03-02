import { cn } from '@/lib/cn';
import type { ReviewStatus } from '@/lib/types';

interface StatusBadgeProps {
  status: ReviewStatus;
  className?: string;
}

const statusConfig: Record<
  ReviewStatus,
  { label: string; classes: string }
> = {
  PASSED: {
    label: 'Passed',
    classes: 'bg-green-500/15 text-green-400 border-green-500/25',
  },
  FAILED: {
    label: 'Failed',
    classes: 'bg-red-500/15 text-red-400 border-red-500/25',
  },
  NEEDS_HUMAN_REVIEW: {
    label: 'Needs Review',
    classes: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  },
  SKIPPED: {
    label: 'Skipped',
    classes: 'bg-gray-500/15 text-gray-400 border-gray-500/25',
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        config.classes,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
