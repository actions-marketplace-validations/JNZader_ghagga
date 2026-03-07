import { cn } from '@/lib/cn';
import type { Finding } from '@/lib/types';

interface SeverityBadgeProps {
  severity: Finding['severity'];
  className?: string;
}

const severityConfig: Record<Finding['severity'], { label: string; classes: string }> = {
  critical: {
    label: 'Critical',
    classes: 'bg-red-600/20 text-red-300 border-red-600/30',
  },
  high: {
    label: 'High',
    classes: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  },
  medium: {
    label: 'Medium',
    classes: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  },
  low: {
    label: 'Low',
    classes: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  },
  info: {
    label: 'Info',
    classes: 'bg-gray-500/15 text-gray-400 border-gray-500/25',
  },
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const config = severityConfig[severity];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        config.classes,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
