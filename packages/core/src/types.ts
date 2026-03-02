/**
 * GHAGGA Core Types
 *
 * These types define the contract between the core review engine
 * and all distribution adapters (server, CLI, action).
 */

// ─── Review Input ───────────────────────────────────────────────

export type ReviewMode = 'simple' | 'workflow' | 'consensus';
export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'github';
export type ReviewLevel = 'soft' | 'normal' | 'strict';

export interface ReviewInput {
  /** The unified diff string from the PR or local changes */
  diff: string;

  /** Review mode to use */
  mode: ReviewMode;

  /** Primary LLM provider */
  provider: LLMProvider;

  /** Model identifier (e.g., "claude-sonnet-4-20250514", "gpt-4o") */
  model: string;

  /** Decrypted API key for the LLM provider */
  apiKey: string;

  /** Tool and review configuration */
  settings: ReviewSettings;

  /** Optional context about the PR (not available in CLI mode) */
  context?: ReviewContext;

  /**
   * Database connection for memory operations.
   * Undefined in CLI/Action modes — memory gracefully degrades.
   */
  db?: unknown;
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

  /** LLM provider used (may differ from requested if fallback occurred) */
  provider: LLMProvider;

  /** Model used */
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
  google: 'gemini-2.0-flash',
  github: 'gpt-4o-mini',
};
