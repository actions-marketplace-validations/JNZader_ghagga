/**
 * Tests for ErrorBoundary component.
 * Covers error catching, fallback rendering, and recovery via "Try again".
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// ─── Helper: component that throws on demand ─────────────────────

let shouldThrow = false;

function ThrowingChild() {
  if (shouldThrow) throw new Error('Test render error');
  return <div>Child rendered OK</div>;
}

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  shouldThrow = false;
  // Suppress React error boundary console output during tests
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Child rendered OK')).toBeInTheDocument();
  });

  it('catches render errors and shows default fallback', () => {
    shouldThrow = true;

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test render error')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    shouldThrow = true;

    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom error UI')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('"Try again" button resets the error state and re-renders children', async () => {
    const user = userEvent.setup();
    shouldThrow = true;

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Stop throwing so the re-render succeeds
    shouldThrow = false;

    await user.click(screen.getByText('Try again'));

    expect(screen.getByText('Child rendered OK')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
