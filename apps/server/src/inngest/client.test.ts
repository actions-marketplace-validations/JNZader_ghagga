/**
 * Inngest client configuration tests.
 *
 * Verifies the Inngest client is configured with the correct app ID
 * and exports the expected event type interfaces.
 */

import { describe, expect, it } from 'vitest';
import { inngest } from './client.js';

describe('inngest client', () => {
  it('is configured with app id "ghagga"', () => {
    expect(inngest).toBeDefined();
    expect(inngest.id).toBe('ghagga');
  });

  it('exports an Inngest instance with send capability', () => {
    expect(typeof inngest.send).toBe('function');
  });
});
