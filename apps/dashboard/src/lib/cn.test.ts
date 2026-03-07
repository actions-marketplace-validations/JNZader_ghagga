/**
 * Unit tests for the cn() Tailwind class merge utility.
 *
 * Pure function — no mocking needed.
 */

import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('should merge a single class string', () => {
    expect(cn('p-4')).toBe('p-4');
  });

  it('should merge multiple class strings', () => {
    expect(cn('p-4', 'text-red-500')).toBe('p-4 text-red-500');
  });

  it('should exclude falsy conditional classes', () => {
    expect(cn('p-4', false && 'hidden', 'text-sm')).toBe('p-4 text-sm');
    expect(cn('p-4', undefined, null, 'text-sm')).toBe('p-4 text-sm');
  });

  it('should resolve Tailwind merge conflicts (last wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
});
