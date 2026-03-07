/**
 * Unit tests for schema constants — DEFAULT_REPO_SETTINGS.
 *
 * Pure constant — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_REPO_SETTINGS } from './schema.js';

// ─── DEFAULT_REPO_SETTINGS ──────────────────────────────────────

describe('DEFAULT_REPO_SETTINGS', () => {
  it('should have all 7 keys matching RepoSettings interface with correct defaults', () => {
    expect(DEFAULT_REPO_SETTINGS).toEqual({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      enableMemory: true,
      customRules: [],
      ignorePatterns: expect.any(Array),
      reviewLevel: 'normal',
    });
  });

  it('should have the expected default ignorePatterns', () => {
    expect(DEFAULT_REPO_SETTINGS.ignorePatterns).toEqual(
      ['*.md', '*.txt', '.gitignore', 'LICENSE', '*.lock'],
    );
  });
});
