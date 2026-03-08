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
  ConsensusStance,
  ConsensusVote,
  FindingSeverity,
  FindingSource,
  ListObservationsOptions,
  LLMProvider,
  MemoryObservation,
  MemoryObservationDetail,
  MemoryObservationRow,
  MemoryStats,
  MemoryStorage,
  // Memory types
  ObservationType,
  // Progress callback types
  ProgressCallback,
  ProgressEvent,
  ProviderChainEntry,
  ReviewContext,
  ReviewFinding,
  // Input types
  ReviewInput,
  ReviewLevel,
  ReviewMetadata,
  ReviewMode,
  // Output types
  ReviewResult,
  ReviewSettings,
  ReviewStatus,
  SaaSProvider,
  // Static analysis types
  StaticAnalysisResult,
  ToolResult,
  ToolStatus,
  // Agent types
  WorkflowSpecialist,
} from './types.js';

// ─── Constants ──────────────────────────────────────────────────

export { DEFAULT_MODELS, DEFAULT_SETTINGS } from './types.js';

// ─── Utilities (for advanced usage) ─────────────────────────────

export type { DiffFile } from './utils/diff.js';
export { filterIgnoredFiles, parseDiffFiles, truncateDiff } from './utils/diff.js';
export { detectStacks } from './utils/stack-detect.js';
export { calculateTokenBudget, getContextWindow } from './utils/token-budget.js';

// ─── Providers (for direct model access) ────────────────────────

export type { FallbackOptions, FallbackProvider, FallbackResult } from './providers/fallback.js';
export { generateWithFallback } from './providers/fallback.js';
export { createModel, createProvider } from './providers/index.js';

// ─── Memory (for custom memory integrations) ────────────────────

export { formatMemoryContext } from './memory/context.js';
export { EngramMemoryStorage } from './memory/engram.js';
export { stripPrivateData } from './memory/privacy.js';
export { SqliteMemoryStorage, type SqliteMemoryStorageOptions } from './memory/sqlite.js';

// ─── Formatting ─────────────────────────────────────────────────

export { formatReviewComment, SEVERITY_EMOJI, STATUS_EMOJI } from './format.js';

// ─── Extensible Tool System ─────────────────────────────────────

export type {
  ActivatedTool,
  ExecOptions,
  ExecutionContext,
  RawToolOutput,
  TimeBudget,
  ToolActivationInput,
  ToolCategory,
  ToolDefinition,
  ToolName,
  ToolTier,
} from './tools/index.js';

export {
  allocateTimeBudget,
  createNodeExecutionContext,
  getEffectiveBudget,
  initializeDefaultTools,
  isToolRegistryEnabled,
  resetInitialization,
  resolveActivatedTools,
  runTools,
  ToolRegistry,
  toolRegistry,
} from './tools/index.js';
