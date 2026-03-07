/**
 * GHAGGA Core Types
 *
 * These types define the contract between the core review engine
 * and all distribution adapters (server, CLI, action).
 */

// ─── Review Input ───────────────────────────────────────────────

export type ReviewMode = 'simple' | 'workflow' | 'consensus';
export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'github' | 'ollama' | 'qwen';

/** Providers available in the SaaS dashboard (excludes Ollama) */
export type SaaSProvider = 'anthropic' | 'openai' | 'google' | 'github' | 'qwen';

export type ReviewLevel = 'soft' | 'normal' | 'strict';

// ─── Provider Chain ─────────────────────────────────────────────

/**
 * A single entry in the provider fallback chain.
 * Used by the SaaS server to configure ordered LLM providers per repo.
 * The pipeline tries providers in array order, falling back on retryable errors.
 */
export interface ProviderChainEntry {
  /** LLM provider identifier */
  provider: SaaSProvider;

  /** Model identifier (e.g., "gpt-4o-mini") */
  model: string;

  /** Decrypted API key (populated at runtime by the server, never stored in plaintext) */
  apiKey: string;
}

/**
 * Progress callback for pipeline steps.
 * Used by the CLI in --verbose mode to show real-time progress.
 */
export type ProgressCallback = (event: ProgressEvent) => void;

export interface ProgressEvent {
  /** Pipeline step identifier */
  step: string;

  /** Human-readable message */
  message: string;

  /** Optional details (e.g., specialist output, vote reasoning) */
  detail?: string;
}

export interface ReviewInput {
  /** The unified diff string from the PR or local changes */
  diff: string;

  /** Review mode to use */
  mode: ReviewMode;

  // ── Single provider (CLI/Action backward compat) ──────────

  /** Primary LLM provider (used when providerChain is not set) */
  provider?: LLMProvider;

  /** Model identifier (e.g., "claude-sonnet-4-20250514", "gpt-4o") */
  model?: string;

  /** Decrypted API key for the LLM provider */
  apiKey?: string;

  // ── Provider chain (SaaS mode) ────────────────────────────

  /**
   * Ordered list of providers to try. Index 0 = primary.
   * When set, takes precedence over provider/model/apiKey.
   */
  providerChain?: ProviderChainEntry[];

  /**
   * Whether AI review is enabled. Defaults to true.
   * When false, only static analysis tools run (no LLM calls).
   */
  aiReviewEnabled?: boolean;

  /** Tool and review configuration */
  settings: ReviewSettings;

  /** Optional context about the PR (not available in CLI mode) */
  context?: ReviewContext;

  /**
   * Memory storage backend for search and persist operations.
   * Undefined when memory is disabled or unavailable — pipeline degrades gracefully.
   */
  memoryStorage?: MemoryStorage;

  /**
   * Optional progress callback for verbose/debug output.
   * Called at each pipeline step with status updates.
   */
  onProgress?: ProgressCallback;

  /**
   * Pre-computed static analysis results from an external runner (e.g., GitHub Actions).
   * When provided, the pipeline skips local tool execution and uses these results directly.
   * Undefined in CLI/Action modes where tools run locally.
   */
  precomputedStaticAnalysis?: StaticAnalysisResult;
}

export interface ReviewSettings {
  enableSemgrep: boolean;
  enableTrivy: boolean;
  enableCpd: boolean;
  enableMemory: boolean;
  customRules: string[];
  ignorePatterns: string[];
  reviewLevel: ReviewLevel;
}

export interface ReviewContext {
  /** Repository full name (e.g., "owner/repo") */
  repoFullName: string;

  /** Pull request number */
  prNumber: number;

  /** Commit messages in the PR */
  commitMessages: string[];

  /** List of all file paths in the diff */
  fileList: string[];
}

// ─── Review Output ──────────────────────────────────────────────

export type ReviewStatus = 'PASSED' | 'FAILED' | 'NEEDS_HUMAN_REVIEW' | 'SKIPPED';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingSource = 'ai' | 'semgrep' | 'trivy' | 'cpd';

export interface ReviewResult {
  /** Overall review status */
  status: ReviewStatus;

  /** Human-readable summary (2-3 sentences) */
  summary: string;

  /** All findings from AI agents and static analysis */
  findings: ReviewFinding[];

  /** Static analysis results per tool */
  staticAnalysis: StaticAnalysisResult;

  /** Memory context that was injected into agent prompts (if any) */
  memoryContext: string | null;

  /** Execution metadata */
  metadata: ReviewMetadata;
}

export interface ReviewFinding {
  /** Severity level */
  severity: FindingSeverity;

  /** Category (e.g., "security", "performance", "style", "bug") */
  category: string;

  /** File path relative to repo root */
  file: string;

  /** Line number (if applicable) */
  line?: number;

  /** Description of the finding */
  message: string;

  /** Suggested fix or improvement */
  suggestion?: string;

  /** Which tool or agent produced this finding */
  source: FindingSource;
}

export interface ReviewMetadata {
  /** Review mode used */
  mode: ReviewMode;

  /** LLM provider used (may differ from requested if fallback occurred). 'none' for static-only. */
  provider: LLMProvider | 'none';

  /** Model used. 'static-only' when AI review is disabled. */
  model: string;

  /** Total tokens consumed */
  tokensUsed: number;

  /** Total execution time in milliseconds */
  executionTimeMs: number;

  /** Static analysis tools that ran successfully */
  toolsRun: string[];

  /** Static analysis tools that were skipped or failed */
  toolsSkipped: string[];
}

// ─── Static Analysis ────────────────────────────────────────────

export type ToolStatus = 'success' | 'skipped' | 'error';

export interface ToolResult {
  /** Whether the tool ran successfully */
  status: ToolStatus;

  /** Findings from this tool */
  findings: ReviewFinding[];

  /** Error message if status is 'error' */
  error?: string;

  /** Execution time in milliseconds */
  executionTimeMs: number;
}

export interface StaticAnalysisResult {
  semgrep: ToolResult;
  trivy: ToolResult;
  cpd: ToolResult;
}

// ─── Agent Types ────────────────────────────────────────────────

export type WorkflowSpecialist =
  | 'scope-analysis'
  | 'coding-standards'
  | 'error-handling'
  | 'security-audit'
  | 'performance-review';

export type ConsensusStance = 'for' | 'against' | 'neutral';

export interface ConsensusVote {
  /** Which provider cast this vote */
  provider: LLMProvider;

  /** Model used */
  model: string;

  /** Assigned stance */
  stance: ConsensusStance;

  /** Decision: approve, reject, or abstain */
  decision: 'approve' | 'reject' | 'abstain';

  /** Confidence level (0-1) */
  confidence: number;

  /** Reasoning for the decision */
  reasoning: string;
}

// ─── Memory Types ───────────────────────────────────────────────

export type ObservationType =
  | 'decision'
  | 'pattern'
  | 'bugfix'
  | 'learning'
  | 'architecture'
  | 'config'
  | 'discovery';

export interface MemoryObservation {
  /** Observation type */
  type: ObservationType;

  /** Concise title */
  title: string;

  /** Structured content (what happened, why it matters, what was learned) */
  content: string;

  /** Project identifier (e.g., "owner/repo") */
  project: string;

  /** Session ID this observation belongs to */
  sessionId?: number;

  /** Stable key for upsert (evolving knowledge) */
  topicKey?: string;

  /** Affected file paths */
  filePaths: string[];
}

/**
 * Abstract storage backend for the memory system.
 * Implemented by SqliteMemoryStorage (CLI/Action) and PostgresMemoryStorage (SaaS).
 */
export interface MemoryStorage {
  searchObservations(
    project: string,
    query: string,
    options?: { limit?: number; type?: string },
  ): Promise<MemoryObservationRow[]>;

  saveObservation(data: {
    sessionId?: number;
    project: string;
    type: string;
    title: string;
    content: string;
    topicKey?: string;
    filePaths?: string[];
    severity?: string;
  }): Promise<MemoryObservationRow>;

  createSession(data: {
    project: string;
    prNumber?: number;
  }): Promise<{ id: number }>;

  endSession(sessionId: number, summary: string): Promise<void>;

  /** Release resources. SQLite: export to disk. PostgreSQL: no-op. */
  close(): Promise<void>;

  // ── Management methods (this change) ──────────────────────────

  /** List observations with optional filtering and pagination. */
  listObservations(options?: ListObservationsOptions): Promise<MemoryObservationDetail[]>;

  /** Get a single observation by ID. Returns null if not found. */
  getObservation(id: number): Promise<MemoryObservationDetail | null>;

  /** Delete a single observation by ID. Returns true if deleted, false if not found. */
  deleteObservation(id: number): Promise<boolean>;

  /** Get aggregate statistics about the memory store. */
  getStats(): Promise<MemoryStats>;

  /** Delete all observations, optionally scoped to a project. Returns count of deleted rows. */
  clearObservations(options?: { project?: string }): Promise<number>;
}

/**
 * Subset of observation columns returned to consumers.
 * Both adapters map their full row type to this shape.
 */
export interface MemoryObservationRow {
  id: number;
  type: string;
  title: string;
  content: string;
  filePaths: string[] | null;
  severity: string | null;
}

/**
 * Full observation row with all database columns.
 * Used by management commands (list, show, stats).
 * Extends MemoryObservationRow with metadata fields.
 */
export interface MemoryObservationDetail {
  id: number;
  type: string;
  title: string;
  content: string;
  filePaths: string[] | null;
  severity: string | null;
  project: string;
  topicKey: string | null;
  revisionCount: number;
  createdAt: string;   // ISO 8601 from SQLite datetime()
  updatedAt: string;   // ISO 8601 from SQLite datetime()
}

/**
 * Aggregate statistics about the memory store.
 * Used by the `ghagga memory stats` command.
 */
export interface MemoryStats {
  totalObservations: number;
  byType: Record<string, number>;
  byProject: Record<string, number>;
  oldestObservation: string | null;  // ISO 8601, null if empty
  newestObservation: string | null;  // ISO 8601, null if empty
}

/**
 * Options for listing observations with filtering and pagination.
 */
export interface ListObservationsOptions {
  project?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

// ─── Configuration Defaults ─────────────────────────────────────

export const DEFAULT_SETTINGS: ReviewSettings = {
  enableSemgrep: true,
  enableTrivy: true,
  enableCpd: true,
  enableMemory: true,
  customRules: [],
  ignorePatterns: ['*.md', '*.txt', '.gitignore', 'LICENSE', '*.lock'],
  reviewLevel: 'normal',
};

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
  github: 'gpt-4o-mini',
  ollama: 'qwen2.5-coder:7b',
  qwen: 'qwen-coder-plus',
};
