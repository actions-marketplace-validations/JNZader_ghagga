/**
 * Tests for memory command shared utilities.
 *
 * Tests pure formatting functions only (no mocking needed).
 * formatTable, formatSize, formatId, truncate.
 *
 * @see T7.1
 */

import { describe, it, expect } from 'vitest';
import { formatTable, formatSize, formatId, truncate } from './utils.js';

// ─── formatTable ────────────────────────────────────────────────

describe('formatTable', () => {
  it('renders headers, separator, and data rows', () => {
    const headers = ['Name', 'Age'];
    const rows = [
      ['Alice', '30'],
      ['Bob', '25'],
    ];
    const widths = [10, 5];

    const result = formatTable(headers, rows, widths);
    const lines = result.split('\n');

    expect(lines).toHaveLength(4); // header + separator + 2 rows
    expect(lines[0]).toBe('Name        Age  ');
    expect(lines[1]).toContain('──────────');
    expect(lines[2]).toBe('Alice       30   ');
    expect(lines[3]).toBe('Bob         25   ');
  });

  it('uses ─ characters for separator row', () => {
    const result = formatTable(['H'], [['D']], [8]);
    const lines = result.split('\n');

    expect(lines[1]).toBe('────────');
  });

  it('pads columns to specified widths', () => {
    const result = formatTable(['A', 'B'], [['x', 'y']], [5, 3]);
    const lines = result.split('\n');

    // 'A' padded to 5 + '  ' + 'B' padded to 3
    expect(lines[0]).toBe('A      B  ');
  });

  it('handles empty rows array', () => {
    const result = formatTable(['H1', 'H2'], [], [5, 5]);
    const lines = result.split('\n');

    expect(lines).toHaveLength(2); // header + separator only
  });
});

// ─── formatSize ─────────────────────────────────────────────────

describe('formatSize', () => {
  it('formats bytes when under 1024', () => {
    expect(formatSize(0)).toBe('0 bytes');
    expect(formatSize(512)).toBe('512 bytes');
    expect(formatSize(1023)).toBe('1023 bytes');
  });

  it('formats KB when >= 1024 and < 1MB', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(512 * 1024)).toBe('512.0 KB');
    expect(formatSize(1024 * 1024 - 1)).toBe('1024.0 KB');
  });

  it('formats MB when >= 1MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(2457600)).toBe('2.3 MB');
    expect(formatSize(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});

// ─── formatId ───────────────────────────────────────────────────

describe('formatId', () => {
  it('zero-pads small IDs to 8 characters', () => {
    expect(formatId(42)).toBe('00000042');
    expect(formatId(1)).toBe('00000001');
    expect(formatId(0)).toBe('00000000');
  });

  it('returns full ID when already 8 digits or more', () => {
    expect(formatId(12345678)).toBe('12345678');
    expect(formatId(123456789)).toBe('123456789');
  });

  it('pads 7-digit ID to 8 characters', () => {
    expect(formatId(1234567)).toBe('01234567');
  });
});

// ─── truncate ───────────────────────────────────────────────────

describe('truncate', () => {
  it('returns short strings as-is', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('exact', 5)).toBe('exact');
  });

  it('truncates long strings with ... suffix', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
    expect(truncate('a very long string that exceeds the limit', 20)).toBe('a very long strin...');
  });

  it('returns empty string as-is', () => {
    expect(truncate('', 10)).toBe('');
  });
});
