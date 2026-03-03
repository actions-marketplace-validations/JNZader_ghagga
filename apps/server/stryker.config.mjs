/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress'],
  concurrency: 4,
  timeoutMS: 30000,
  // Focus on API routes and middleware — where bugs have real user impact
  mutate: [
    'src/routes/api.ts',
    'src/routes/webhook.ts',
    'src/middleware/auth.ts',
    'src/lib/provider-models.ts',
    // Exclude test files
    '!src/**/*.test.ts',
    '!src/**/index.ts',
  ],
  vitest: {
    configFile: 'vitest.config.ts',
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  ignoreMutations: ['StringLiteral'],
};
