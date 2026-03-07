/**
 * Tests for SeverityBadge component.
 * Pure presentational — renders severity label and applies correct CSS classes.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SeverityBadge } from './SeverityBadge';
import type { Finding } from '@/lib/types';

const severities: Array<{ severity: Finding['severity']; label: string }> = [
  { severity: 'critical', label: 'Critical' },
  { severity: 'high', label: 'High' },
  { severity: 'medium', label: 'Medium' },
  { severity: 'low', label: 'Low' },
  { severity: 'info', label: 'Info' },
];

describe('SeverityBadge', () => {
  it.each(severities)(
    'renders "$label" text for severity "$severity"',
    ({ severity, label }) => {
      render(<SeverityBadge severity={severity} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it('applies custom className', () => {
    render(<SeverityBadge severity="critical" className="my-custom" />);
    const badge = screen.getByText('Critical');
    expect(badge.className).toContain('my-custom');
  });
});
