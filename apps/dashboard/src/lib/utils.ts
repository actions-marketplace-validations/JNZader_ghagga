import type { Finding } from './types';

/**
 * Valid severity values for the SeverityBadge component.
 */
const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  'critical',
  'high',
  'medium',
  'low',
  'info',
]);

/**
 * Type guard: checks if a string is a valid Finding severity.
 * Use before passing observation.severity to SeverityBadge.
 */
export function isValidSeverity(s: string | null): s is Finding['severity'] {
  return s !== null && VALID_SEVERITIES.has(s);
}

/**
 * Numeric weight for severity sorting (higher = more severe).
 */
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

/**
 * Returns a numeric weight for sorting by severity (descending).
 * null/unknown severity gets weight 0 (sorted last).
 */
export function severityWeight(severity: string | null): number {
  if (severity === null) return 0;
  return SEVERITY_WEIGHT[severity] ?? 0;
}

/**
 * Format a date string as a human-readable relative time using Intl.RelativeTimeFormat.
 * Uses vanilla JS — no external dependencies.
 *
 * Examples: "2 minutes ago", "3 hours ago", "5 days ago", "2 months ago"
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();

  // Guard: future dates or invalid
  if (Number.isNaN(diffMs) || diffMs < 0) {
    return 'just now';
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (diffSeconds < 60) {
    return rtf.format(-diffSeconds, 'second');
  }
  if (diffMinutes < 60) {
    return rtf.format(-diffMinutes, 'minute');
  }
  if (diffHours < 24) {
    return rtf.format(-diffHours, 'hour');
  }
  if (diffDays < 30) {
    return rtf.format(-diffDays, 'day');
  }
  if (diffMonths < 12) {
    return rtf.format(-diffMonths, 'month');
  }
  return rtf.format(-diffYears, 'year');
}
