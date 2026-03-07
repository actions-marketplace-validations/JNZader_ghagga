/**
 * @ghagga/core — Public API
 *
 * The core review engine for GHAGGA v2.
 * This module re-exports the pipeline entry point and all public types.
 */

// ─── Pipeline ───────────────────────────────────────────────────

export { reviewPipeline } from './pipeline.js';

// ─── Types ──────────────────────────────────────────────────────

export type {
  // Input types
  ReviewInput,
  ReviewSettings,
  ReviewContext,
  ReviewMode,
  LLMProvider,
  SaaSProvider,
  ProviderChainEntry,
  ReviewLevel,

  // Output types
  ReviewResult,
  ReviewFinding,
  ReviewMetadata,
  ReviewStatus,
  FindingSeverity,
  FindingSource,

  // Static analysis types
  StaticAnalysisResult,
  ToolResult,
  ToolStatus,

  // Agent types
  WorkflowSpecialist,
  ConsensusStance,
  ConsensusVote,

  // Memory types
  ObservationType,
  MemoryObservation,
  MemoryStorage,
  MemoryObservationRow,
  MemoryObservationDetail,
  MemoryStats,
  ListObservationsOptions,

  // Progress callback types
  ProgressCallback,
  ProgressEvent,
} from './types.js';

// ─── Constants ──────────────────────────────────────────────────

export { DEFAULT_SETTINGS, DEFAULT_MODELS } from './types.js';

// ─── Utilities (for advanced usage) ─────────────────────────────

export { detectStacks } from './utils/stack-detect.js';
export { parseDiffFiles, filterIgnoredFiles, truncateDiff } from './utils/diff.js';
export type { DiffFile } from './utils/diff.js';
export { getContextWindow, calculateTokenBudget } from './utils/token-budget.js';

// ─── Providers (for direct model access) ────────────────────────

export { createProvider, createModel } from './providers/index.js';
export { generateWithFallback } from './providers/fallback.js';
export type { FallbackProvider, FallbackOptions, FallbackResult } from './providers/fallback.js';

// ─── Memory (for custom memory integrations) ────────────────────

export { formatMemoryContext } from './memory/context.js';
export { stripPrivateData } from './memory/privacy.js';
export { SqliteMemoryStorage } from './memory/sqlite.js';

// ─── Formatting ─────────────────────────────────────────────────

export { formatReviewComment, STATUS_EMOJI, SEVERITY_EMOJI } from './format.js';
