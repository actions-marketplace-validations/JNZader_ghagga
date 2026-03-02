import { describe, it, expect } from 'vitest';
import {
  buildStaticAnalysisContext,
  buildMemoryContext,
  buildStackHints,
  SIMPLE_REVIEW_SYSTEM,
  WORKFLOW_SCOPE_SYSTEM,
  CONSENSUS_FOR_SYSTEM,
} from './prompts.js';

// ─── buildStaticAnalysisContext ─────────────────────────────────

describe('buildStaticAnalysisContext', () => {
  it('returns empty string for empty input', () => {
    expect(buildStaticAnalysisContext('')).toBe('');
  });

  it('returns empty string for falsy input', () => {
    // The function checks `!staticFindings`, so empty string is falsy
    expect(buildStaticAnalysisContext('')).toBe('');
  });

  it('wraps content with newlines when provided', () => {
    const result = buildStaticAnalysisContext('some findings');
    expect(result).toBe('\n\nsome findings\n');
  });

  it('preserves the input content', () => {
    const input = '[SEMGREP] [critical] src/auth.ts:42 - SQL injection';
    const result = buildStaticAnalysisContext(input);
    expect(result).toContain(input);
  });
});

// ─── buildMemoryContext ─────────────────────────────────────────

describe('buildMemoryContext', () => {
  it('returns empty string for null', () => {
    expect(buildMemoryContext(null)).toBe('');
  });

  it('returns empty string for empty string', () => {
    // Empty string is falsy, so `!memoryContext` is true
    expect(buildMemoryContext('')).toBe('');
  });

  it('wraps content with header when provided', () => {
    const result = buildMemoryContext('This repo uses strict null checks');
    expect(result).not.toBe('');
    expect(result.length).toBeGreaterThan('This repo uses strict null checks'.length);
  });

  it('includes "Past Review Memory" section title', () => {
    const result = buildMemoryContext('Some memory context');
    expect(result).toContain('Past Review Memory');
  });

  it('includes guidance footer', () => {
    const result = buildMemoryContext('Some memory context');
    expect(result).toContain('Use these past observations to give more informed, context-aware reviews.');
  });
});

// ─── buildStackHints ────────────────────────────────────────────

describe('buildStackHints', () => {
  it('returns empty string for empty stacks array', () => {
    expect(buildStackHints([])).toBe('');
  });

  it('returns TypeScript hint for ["typescript"]', () => {
    const result = buildStackHints(['typescript']);
    expect(result).toContain('type safety');
    expect(result).toContain('strict null checks');
  });

  it('returns React hint for ["react"]', () => {
    const result = buildStackHints(['react']);
    expect(result).toContain('hooks');
    expect(result).toContain('re-renders');
  });

  it('returns combined hints for multiple stacks', () => {
    const result = buildStackHints(['typescript', 'react']);
    expect(result).toContain('type safety');
    expect(result).toContain('hooks');
  });

  it('returns empty string for unknown stacks only', () => {
    // 'elixir' is not in the hints object, so relevant[] is empty
    expect(buildStackHints(['elixir'])).toBe('');
  });

  it('includes "Stack-Specific Review Hints" header', () => {
    const result = buildStackHints(['python']);
    expect(result).toContain('Stack-Specific Review Hints');
  });

  it('ignores unknown stacks while keeping known ones', () => {
    const result = buildStackHints(['elixir', 'go', 'cobol']);
    expect(result).toContain('error handling patterns');
    expect(result).toContain('goroutine leaks');
  });

  it('handles case-insensitive stack names via toLowerCase', () => {
    const result = buildStackHints(['TypeScript']);
    expect(result).toContain('type safety');
  });
});

// ─── Exported Constants ─────────────────────────────────────────

describe('prompt constants', () => {
  it('SIMPLE_REVIEW_SYSTEM contains STATUS: format instruction', () => {
    expect(SIMPLE_REVIEW_SYSTEM).toContain('STATUS:');
  });

  it('WORKFLOW_SCOPE_SYSTEM contains scope-related content', () => {
    expect(WORKFLOW_SCOPE_SYSTEM).toContain('scope');
  });

  it('CONSENSUS_FOR_SYSTEM contains IN FAVOR', () => {
    expect(CONSENSUS_FOR_SYSTEM).toContain('IN FAVOR');
  });
});
