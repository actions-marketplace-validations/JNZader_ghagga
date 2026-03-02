export type ReviewStatus = 'PASSED' | 'FAILED' | 'NEEDS_HUMAN_REVIEW' | 'SKIPPED';

export type ReviewMode = 'simple' | 'workflow' | 'consensus';

export type LLMProvider = 'anthropic' | 'openai' | 'google';

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

export interface RepositorySettings {
  repoId: number;
  repoFullName: string;
  reviewMode: ReviewMode;
  llmProvider: LLMProvider;
  llmModel: string;
  enableSemgrep: boolean;
  enableTrivy: boolean;
  enableCpd: boolean;
  enableMemory: boolean;
  customRules: string;
  ignorePatterns: string[];
  hasApiKey: boolean;
  maskedApiKey?: string;
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
