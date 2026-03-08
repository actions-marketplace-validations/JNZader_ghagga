/**
 * Tests for the deprecated isToolRegistryEnabled function.
 *
 * The feature flag was removed in v2.4.2. The function now always
 * returns true for backward compatibility with existing imports.
 */

import { describe, expect, it } from 'vitest';
import { isToolRegistryEnabled } from '../../runner.js';

describe('isToolRegistryEnabled (deprecated)', () => {
  it('always returns true (feature flag removed)', () => {
    expect(isToolRegistryEnabled()).toBe(true);
  });
});
