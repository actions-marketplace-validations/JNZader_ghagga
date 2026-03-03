/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress'],
  concurrency: 4,
  timeoutMS: 30000,
  // Focus mutation testing on the most critical business logic
  mutate: [
    'src/agents/simple.ts',
    'src/agents/consensus.ts',
    'src/agents/workflow.ts',
    'src/providers/fallback.ts',
    'src/pipeline.ts',
    'src/memory/persist.ts',
    'src/memory/search.ts',
    'src/memory/context.ts',
    'src/memory/privacy.ts',
    'src/utils/diff.ts',
    'src/utils/token-budget.ts',
    'src/utils/stack-detect.ts',
    'src/tools/cpd.ts',
    'src/tools/semgrep.ts',
    'src/tools/trivy.ts',
    'src/tools/runner.ts',
    // Exclude test files and barrel exports
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
  // Ignore string literal mutations (noisy, low value)
  ignoreMutations: ['StringLiteral'],
};
