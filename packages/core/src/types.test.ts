/**
 * Unit tests for configuration defaults exported from types.ts.
 *
 * Pure constants — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_MODELS } from './types.js';

// ─── DEFAULT_SETTINGS ───────────────────────────────────────────

describe('DEFAULT_SETTINGS', () => {
  it('should have all 7 expected keys with correct defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      enableMemory: true,
      customRules: [],
      ignorePatterns: expect.any(Array),
      reviewLevel: 'normal',
    });
  });

  it('should have a non-empty ignorePatterns array', () => {
    expect(DEFAULT_SETTINGS.ignorePatterns.length).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.ignorePatterns).toContain('*.md');
    expect(DEFAULT_SETTINGS.ignorePatterns).toContain('*.lock');
  });
});

// ─── DEFAULT_MODELS ─────────────────────────────────────────────

describe('DEFAULT_MODELS', () => {
  it('should have entries for all 6 LLM providers', () => {
    const providers = ['anthropic', 'openai', 'google', 'github', 'ollama', 'qwen'] as const;
    for (const provider of providers) {
      expect(DEFAULT_MODELS).toHaveProperty(provider);
      expect(typeof DEFAULT_MODELS[provider]).toBe('string');
      expect(DEFAULT_MODELS[provider].length).toBeGreaterThan(0);
    }
  });
});
