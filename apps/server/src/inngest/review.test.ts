import { describe, it, expect } from 'vitest';

describe('inngest/review', () => {
  it('exports reviewFunction', async () => {
    const mod = await import('./review.js');
    expect(mod.reviewFunction).toBeDefined();
  });

  it('reviewFunction has the expected inngest function shape', async () => {
    const mod = await import('./review.js');
    const fn = mod.reviewFunction;

    // Inngest functions are objects with an id and other metadata
    expect(fn).toBeTruthy();
    expect(typeof fn).toBe('object');
  });
});
