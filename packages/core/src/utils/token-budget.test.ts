import { describe, it, expect } from 'vitest';
import { getContextWindow, calculateTokenBudget } from './token-budget.js';

describe('getContextWindow', () => {
  it('returns correct window for claude-sonnet-4-20250514', () => {
    expect(getContextWindow('claude-sonnet-4-20250514')).toBe(200_000);
  });

  it('returns correct window for gpt-4o', () => {
    expect(getContextWindow('gpt-4o')).toBe(128_000);
  });

  it('returns correct window for gemini-2.0-flash', () => {
    expect(getContextWindow('gemini-2.0-flash')).toBe(1_048_576);
  });

  it('returns default (128000) for unknown models', () => {
    expect(getContextWindow('some-unknown-model-v99')).toBe(128_000);
  });
});

describe('calculateTokenBudget', () => {
  it('returns 70/30 split for a known model', () => {
    const budget = calculateTokenBudget('claude-sonnet-4-20250514');
    // 200_000 * 0.7 = 140_000
    expect(budget.diffBudget).toBe(140_000);
    // 200_000 * 0.3 = 60_000
    expect(budget.contextBudget).toBe(60_000);
  });

  it('returns 70/30 split for gpt-4o', () => {
    const budget = calculateTokenBudget('gpt-4o');
    // 128_000 * 0.7 = 89_600
    expect(budget.diffBudget).toBe(89_600);
    // 128_000 * 0.3 = 38_400
    expect(budget.contextBudget).toBe(38_400);
  });

  it('diffBudget + contextBudget approximates total window', () => {
    const models = ['claude-sonnet-4-20250514', 'gpt-4o', 'gemini-2.0-flash', 'unknown-model'];

    for (const model of models) {
      const total = getContextWindow(model);
      const budget = calculateTokenBudget(model);
      // Due to Math.floor, the sum may be slightly less than total
      expect(budget.diffBudget + budget.contextBudget).toBeLessThanOrEqual(total);
      // But the difference should be at most 1 (from two floor operations)
      expect(total - (budget.diffBudget + budget.contextBudget)).toBeLessThanOrEqual(1);
    }
  });

  it('uses default window for unknown models', () => {
    const budget = calculateTokenBudget('totally-unknown');
    expect(budget.diffBudget).toBe(Math.floor(128_000 * 0.7));
    expect(budget.contextBudget).toBe(Math.floor(128_000 * 0.3));
  });
});
