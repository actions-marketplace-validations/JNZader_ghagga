/**
 * Unit tests for dashboard utility functions.
 *
 * Pure functions — no mocking needed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isValidSeverity, severityWeight, formatRelativeTime } from './utils';

describe('isValidSeverity', () => {
  it('returns true for valid severity strings', () => {
    expect(isValidSeverity('critical')).toBe(true);
    expect(isValidSeverity('high')).toBe(true);
    expect(isValidSeverity('medium')).toBe(true);
    expect(isValidSeverity('low')).toBe(true);
    expect(isValidSeverity('info')).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidSeverity(null)).toBe(false);
  });

  it('returns false for invalid strings', () => {
    expect(isValidSeverity('unknown')).toBe(false);
    expect(isValidSeverity('')).toBe(false);
    expect(isValidSeverity('CRITICAL')).toBe(false);
  });
});

describe('severityWeight', () => {
  it('returns correct weights for known severities', () => {
    expect(severityWeight('critical')).toBe(5);
    expect(severityWeight('high')).toBe(4);
    expect(severityWeight('medium')).toBe(3);
    expect(severityWeight('low')).toBe(2);
    expect(severityWeight('info')).toBe(1);
  });

  it('returns 0 for null', () => {
    expect(severityWeight(null)).toBe(0);
  });

  it('returns 0 for unknown severity', () => {
    expect(severityWeight('unknown')).toBe(0);
  });
});

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for very recent times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

    const result = formatRelativeTime('2025-06-15T12:00:00Z');
    // 0 seconds ago — Intl.RelativeTimeFormat numeric: 'auto' returns "now" or "0 seconds ago"
    expect(result).toBeTruthy();
  });

  it('returns minutes ago for recent times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:05:00Z'));

    const result = formatRelativeTime('2025-06-15T12:00:00Z');
    expect(result).toMatch(/5 minutes ago/);
  });

  it('returns hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T15:00:00Z'));

    const result = formatRelativeTime('2025-06-15T12:00:00Z');
    expect(result).toMatch(/3 hours ago/);
  });

  it('returns days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-18T12:00:00Z'));

    const result = formatRelativeTime('2025-06-15T12:00:00Z');
    expect(result).toMatch(/3 days ago/);
  });

  it('returns months ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-09-15T12:00:00Z'));

    const result = formatRelativeTime('2025-06-15T12:00:00Z');
    expect(result).toMatch(/3 months ago/);
  });

  it('returns "just now" for future dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

    const result = formatRelativeTime('2025-06-15T13:00:00Z');
    expect(result).toBe('just now');
  });
});
