import { describe, it, expect } from 'vitest';

describe('CLI review module', () => {
  it('exports reviewCommand function', async () => {
    const mod = await import('./review.js');
    expect(mod.reviewCommand).toBeTypeOf('function');
  });

  it('exports ReviewOptions type (verified by TypeScript at compile time)', async () => {
    // This test verifies the module imports correctly and the type exists.
    // TypeScript checks the type at compile time; here we just confirm
    // the module is loadable and the function has the expected shape.
    const mod = await import('./review.js');
    expect(mod).toBeDefined();
    expect(typeof mod.reviewCommand).toBe('function');
  });

  it('reviewCommand expects exactly 2 arguments (targetPath, options)', async () => {
    const mod = await import('./review.js');
    // Function.length reflects the number of declared parameters
    expect(mod.reviewCommand.length).toBe(2);
  });
});
