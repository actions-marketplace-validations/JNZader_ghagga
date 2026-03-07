/**
 * Accessibility tests using vitest-axe.
 * Runs automated axe-core checks on key components.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ObservationDetailModal } from '@/components/ObservationDetailModal';
import { SeverityBadge } from '@/components/SeverityBadge';
import type { Observation } from '@/lib/types';

// ─── Matcher setup ──────────────────────────────────────────────
// vitest-axe 0.1.0 uses the old Vi namespace; extend expect manually.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const matchers = await import('vitest-axe/matchers');
expect.extend(matchers);

declare module 'vitest' {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
}

// ─── Fixtures ───────────────────────────────────────────────────

const sampleObservation: Observation = {
  id: 1,
  sessionId: 1,
  type: 'pattern',
  title: 'Test observation',
  content: 'Some content for testing.',
  filePaths: ['src/test.ts'],
  severity: 'high',
  topicKey: 'test-topic',
  revisionCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// ═══════════════════════════════════════════════════════════════════

describe('Accessibility (axe) — Card component', () => {
  it('Card with content has no a11y violations', async () => {
    const { container } = render(
      <Card>
        <CardHeader title="Test Card" description="A test description" />
        <p>Card body content</p>
      </Card>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility (axe) — SeverityBadge', () => {
  it('SeverityBadge has no a11y violations', async () => {
    const { container } = render(
      <div>
        <SeverityBadge severity="critical" />
        <SeverityBadge severity="high" />
        <SeverityBadge severity="medium" />
        <SeverityBadge severity="low" />
        <SeverityBadge severity="info" />
      </div>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility (axe) — ObservationDetailModal', () => {
  it('open modal has no a11y violations', async () => {
    const { container } = render(
      <ObservationDetailModal observation={sampleObservation} onClose={() => {}} />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('closed modal (null observation) has no a11y violations', async () => {
    const { container } = render(<ObservationDetailModal observation={null} onClose={() => {}} />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility (axe) — ConfirmDialog', () => {
  it('open Tier 1 dialog has no a11y violations', async () => {
    const { container } = render(
      <ConfirmDialog
        open={true}
        onConfirm={() => {}}
        onCancel={() => {}}
        title="Delete item"
        description="Are you sure?"
        confirmLabel="Delete"
        confirmVariant="danger"
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('open Tier 2 dialog with text input has no a11y violations', async () => {
    const { container } = render(
      <ConfirmDialog
        open={true}
        onConfirm={() => {}}
        onCancel={() => {}}
        title="Clear memory"
        description="This will delete all data."
        confirmLabel="Clear"
        confirmVariant="danger"
        confirmText="confirm"
        confirmPlaceholder='Type "confirm" to proceed'
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('closed dialog has no a11y violations', async () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        onConfirm={() => {}}
        onCancel={() => {}}
        title="Delete item"
        description="Are you sure?"
        confirmLabel="Delete"
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
