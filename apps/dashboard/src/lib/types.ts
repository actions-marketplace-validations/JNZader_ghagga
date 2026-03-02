export type ReviewStatus = 'PASSED' | 'FAILED' | 'NEEDS_HUMAN_REVIEW' | 'SKIPPED';

export type ReviewMode = 'simple' | 'workflow' | 'consensus';

export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'github' | 'ollama';

/** Providers available in the SaaS dashboard (excludes Ollama) */
export type SaaSProvider = 'anthropic' | 'openai' | 'google' | 'github';

export interface User {
  githubLogin: string;
  githubUserId: number;
  avatarUrl: string;
}

export interface Review {
  id: number;
  repo: string;
  prNumber: number;
  status: ReviewStatus;
  mode: ReviewMode;
  summary: string;
  findings: Finding[];
  createdAt: string;
}

export interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface ReviewsResponse {
  reviews: Review[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Stats {
  totalReviews: number;
  passed: number;
  failed: number;
  needsHumanReview: number;
  skipped: number;
  passRate: number;
  reviewsByDay: DayStats[];
}

export interface DayStats {
  date: string;
  total: number;
  passed: number;
  failed: number;
}

export interface Repository {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  isActive: boolean;
}

// ─── Provider Chain ─────────────────────────────────────────────

/** View of a chain entry from the server (never includes raw keys) */
export interface ProviderChainView {
  provider: SaaSProvider;
  model: string;
  hasApiKey: boolean;
  maskedApiKey?: string;
}

/** Chain entry for updates (sent to PUT /api/settings) */
export interface ProviderChainUpdate {
  provider: SaaSProvider;
  model: string;
  apiKey?: string; // only sent when new/changed
}

/** Provider validation response from POST /api/providers/validate */
export interface ValidationResponse {
  valid: boolean;
  models: string[];
  error?: string;
}

// ─── Settings ───────────────────────────────────────────────────

export interface RepositorySettings {
  repoId: number;
  repoFullName: string;
  aiReviewEnabled: boolean;
  providerChain: ProviderChainView[];
  reviewMode: ReviewMode;
  enableSemgrep: boolean;
  enableTrivy: boolean;
  enableCpd: boolean;
  enableMemory: boolean;
  customRules: string;
  ignorePatterns: string[];
}

export interface MemorySession {
  id: number;
  project: string;
  prNumber: number;
  summary: string;
  createdAt: string;
  observationCount: number;
}

export interface Observation {
  id: number;
  sessionId: number;
  type: 'pattern' | 'preference' | 'convention' | 'issue' | 'decision';
  title: string;
  content: string;
  filePaths: string[];
  createdAt: string;
}
