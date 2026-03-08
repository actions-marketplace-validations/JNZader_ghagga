/**
 * Tests for the GHAGGA_TOOL_REGISTRY feature flag.
 *
 * Validates:
 * - isToolRegistryEnabled() reads env var correctly
 * - Feature flag detection
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isToolRegistryEnabled } from '../../runner.js';

describe('isToolRegistryEnabled', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GHAGGA_TOOL_REGISTRY;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GHAGGA_TOOL_REGISTRY;
    } else {
      process.env.GHAGGA_TOOL_REGISTRY = originalEnv;
    }
  });

  it('returns false when env var is not set', () => {
    delete process.env.GHAGGA_TOOL_REGISTRY;
    expect(isToolRegistryEnabled()).toBe(false);
  });

  it('returns false when env var is empty', () => {
    process.env.GHAGGA_TOOL_REGISTRY = '';
    expect(isToolRegistryEnabled()).toBe(false);
  });

  it('returns false when env var is "false"', () => {
    process.env.GHAGGA_TOOL_REGISTRY = 'false';
    expect(isToolRegistryEnabled()).toBe(false);
  });

  it('returns true when env var is "true"', () => {
    process.env.GHAGGA_TOOL_REGISTRY = 'true';
    expect(isToolRegistryEnabled()).toBe(true);
  });

  it('returns false for "TRUE" (case-sensitive)', () => {
    process.env.GHAGGA_TOOL_REGISTRY = 'TRUE';
    expect(isToolRegistryEnabled()).toBe(false);
  });

  it('returns false for "1"', () => {
    process.env.GHAGGA_TOOL_REGISTRY = '1';
    expect(isToolRegistryEnabled()).toBe(false);
  });
});
