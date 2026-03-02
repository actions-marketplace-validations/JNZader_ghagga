/**
 * Main review pipeline orchestrator.
 *
 * Coordinates the entire review flow:
 *   1. Validate input
 *   2. Parse and filter the diff
 *   3. Detect tech stacks
 *   4. Run static analysis tools
 *   5. Search memory for past context
 *   6. Execute the selected agent mode
 *   7. Persist new observations to memory
 *   8. Return the final result
 *
 * Each step degrades gracefully — if static analysis fails, or
 * memory is unavailable, the pipeline continues with what it has.
 */

import { parseDiffFiles, filterIgnoredFiles, truncateDiff } from './utils/diff.js';
import { detectStacks } from './utils/stack-detect.js';
import { calculateTokenBudget } from './utils/token-budget.js';
import { runStaticAnalysis, formatStaticAnalysisContext } from './tools/runner.js';
import { searchMemoryForContext } from './memory/search.js';
import { persistReviewObservations } from './memory/persist.js';
import { buildStackHints } from './agents/prompts.js';
import { runSimpleReview } from './agents/simple.js';
import { runWorkflowReview } from './agents/workflow.js';
import { runConsensusReview } from './agents/consensus.js';
import type { ReviewInput, ReviewResult, ReviewStatus } from './types.js';

// ─── Validation ─────────────────────────────────────────────────

/**
 * Validate the review input for required fields.
 * Throws descriptive errors for misconfiguration.
 */
function validateInput(input: ReviewInput): void {
  if (!input.diff || input.diff.trim().length === 0) {
    throw new Error('Review input must include a non-empty diff');
  }

  if (!input.apiKey) {
    throw new Error('Review input must include an API key');
  }

  if (!input.provider) {
    throw new Error('Review input must specify an LLM provider');
  }

  if (!input.model) {
    throw new Error('Review input must specify a model');
  }
}

// ─── Pipeline ───────────────────────────────────────────────────

/**
 * Run the full review pipeline.
 *
 * This is the primary entry point for all review operations.
 * It orchestrates parsing, analysis, agent execution, and
 * memory operations in a resilient pipeline that degrades
 * gracefully when optional components fail.
 *
 * @param input - Complete review input with diff, config, and settings
 * @returns ReviewResult with status, findings, and metadata
 */
export async function reviewPipeline(input: ReviewInput): Promise<ReviewResult> {
  const startTime = Date.now();

  // ── Step 1: Validate ───────────────────────────────────────
  validateInput(input);

  // ── Step 2: Parse and filter the diff ──────────────────────
  const allFiles = parseDiffFiles(input.diff);
  const filteredFiles = filterIgnoredFiles(allFiles, input.settings.ignorePatterns);

  // If all files were filtered out, skip the review
  if (filteredFiles.length === 0) {
    return createSkippedResult(input, startTime);
  }

  // Reconstruct filtered diff and get file list
  const filteredDiff = filteredFiles.map((f) => f.content).join('\n');
  const fileList = filteredFiles.map((f) => f.path);

  // ── Step 3: Detect tech stacks ─────────────────────────────
  const stacks = detectStacks(fileList);
  const stackHints = buildStackHints(stacks);

  // ── Step 4: Truncate diff to fit token budget ──────────────
  const { diffBudget } = calculateTokenBudget(input.model);
  const { truncated: truncatedDiff } = truncateDiff(filteredDiff, diffBudget);

  // ── Step 5: Run static analysis (in parallel with memory) ──
  const [staticResult, memoryContext] = await Promise.all([
    runStaticAnalysisSafe(fileList, input),
    searchMemorySafe(input, fileList),
  ]);

  const staticContext = formatStaticAnalysisContext(staticResult);

  // ── Step 6: Execute agent mode ─────────────────────────────
  let result: ReviewResult;

  switch (input.mode) {
    case 'simple':
      result = await runSimpleReview({
        diff: truncatedDiff,
        provider: input.provider,
        model: input.model,
        apiKey: input.apiKey,
        staticContext,
        memoryContext,
        stackHints,
      });
      break;

    case 'workflow':
      result = await runWorkflowReview({
        diff: truncatedDiff,
        provider: input.provider,
        model: input.model,
        apiKey: input.apiKey,
        staticContext,
        memoryContext,
        stackHints,
      });
      break;

    case 'consensus':
      // Consensus mode uses the primary model with different stances
      // In production, the caller would configure multiple models via the context
      result = await runConsensusReview({
        diff: truncatedDiff,
        models: [
          { provider: input.provider, model: input.model, apiKey: input.apiKey, stance: 'for' },
          { provider: input.provider, model: input.model, apiKey: input.apiKey, stance: 'against' },
          { provider: input.provider, model: input.model, apiKey: input.apiKey, stance: 'neutral' },
        ],
        staticContext,
        memoryContext,
        stackHints,
      });
      break;

    default: {
      const _exhaustive: never = input.mode;
      throw new Error(`Unknown review mode: ${_exhaustive}`);
    }
  }

  // ── Step 7: Merge static analysis into result ──────────────
  result.staticAnalysis = staticResult;
  result.memoryContext = memoryContext;

  // Add static analysis findings to the result's findings array
  const staticFindings = [
    ...staticResult.semgrep.findings,
    ...staticResult.trivy.findings,
    ...staticResult.cpd.findings,
  ];
  result.findings = [...result.findings, ...staticFindings];

  // Track which tools ran successfully
  result.metadata.toolsRun = [];
  result.metadata.toolsSkipped = [];
  for (const [name, tool] of Object.entries(staticResult)) {
    if (tool.status === 'success') {
      result.metadata.toolsRun.push(name);
    } else {
      result.metadata.toolsSkipped.push(name);
    }
  }

  // Update execution time to cover the full pipeline
  result.metadata.executionTimeMs = Date.now() - startTime;

  // ── Step 8: Persist to memory (fire-and-forget) ────────────
  if (input.settings.enableMemory && input.db && input.context) {
    // Don't await — memory persistence shouldn't block the response
    persistReviewObservations(
      input.db,
      input.context.repoFullName,
      input.context.prNumber,
      result,
    ).catch((error: unknown) => {
      console.warn(
        '[ghagga] Memory persist failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Run static analysis with graceful degradation.
 * Returns a result with all tools skipped if anything goes wrong.
 */
async function runStaticAnalysisSafe(
  fileList: string[],
  input: ReviewInput,
) {
  try {
    // Build a file map for static analysis (paths only, content from diff)
    const files = new Map<string, string>();
    for (const path of fileList) {
      files.set(path, ''); // Content is extracted from diff by the tool runner
    }

    return await runStaticAnalysis(files, '.', {
      enableSemgrep: input.settings.enableSemgrep,
      enableTrivy: input.settings.enableTrivy,
      enableCpd: input.settings.enableCpd,
      customRules: input.settings.customRules,
    });
  } catch (error) {
    console.warn(
      '[ghagga] Static analysis failed (degrading gracefully):',
      error instanceof Error ? error.message : String(error),
    );

    const errorResult = {
      status: 'error' as const,
      findings: [],
      error: error instanceof Error ? error.message : String(error),
      executionTimeMs: 0,
    };

    return {
      semgrep: errorResult,
      trivy: errorResult,
      cpd: errorResult,
    };
  }
}

/**
 * Search memory with graceful degradation.
 * Returns null if memory is disabled or unavailable.
 */
async function searchMemorySafe(
  input: ReviewInput,
  fileList: string[],
): Promise<string | null> {
  if (!input.settings.enableMemory || !input.db || !input.context) {
    return null;
  }

  try {
    return await searchMemoryForContext(
      input.db,
      input.context.repoFullName,
      fileList,
    );
  } catch (error) {
    console.warn(
      '[ghagga] Memory search failed (degrading gracefully):',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Create a SKIPPED result when all files are filtered out.
 */
function createSkippedResult(input: ReviewInput, startTime: number): ReviewResult {
  return {
    status: 'SKIPPED' as ReviewStatus,
    summary: 'All files in the diff matched ignore patterns. No review was performed.',
    findings: [],
    staticAnalysis: {
      semgrep: { status: 'skipped', findings: [], executionTimeMs: 0 },
      trivy: { status: 'skipped', findings: [], executionTimeMs: 0 },
      cpd: { status: 'skipped', findings: [], executionTimeMs: 0 },
    },
    memoryContext: null,
    metadata: {
      mode: input.mode,
      provider: input.provider,
      model: input.model,
      tokensUsed: 0,
      executionTimeMs: Date.now() - startTime,
      toolsRun: [],
      toolsSkipped: ['semgrep', 'trivy', 'cpd'],
    },
  };
}
