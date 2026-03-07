/**
 * Engram adapter types.
 *
 * Defines configuration and API response shapes for the Engram REST API.
 * These types are internal to the Engram adapter — not exported from @ghagga/core.
 */

// ─── Configuration ──────────────────────────────────────────────

/** Configuration for connecting to an Engram server. */
export interface EngramConfig {
  /** Engram server base URL (default: 'http://localhost:7437') */
  host: string;

  /** HTTP request timeout in milliseconds (default: 5000) */
  timeout: number;
}

/** Default Engram configuration values. */
export const ENGRAM_DEFAULTS: EngramConfig = {
  host: 'http://localhost:7437',
  timeout: 5000,
};

// ─── Engram API Response Types ──────────────────────────────────

/** Shape of an observation returned by Engram's REST API. */
export interface EngramObservation {
  id: string | number;
  type: string;
  title: string;
  content: string;
  project?: string;
  topic_key?: string;
  revision_count?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  duplicate_count?: number;
  last_seen_at?: string;
  scope?: string;
}

/** Shape of Engram's session response. */
export interface EngramSession {
  id: number;
  project: string;
  started_at?: string;
  ended_at?: string | null;
  summary?: string | null;
}

/** Shape of Engram's GET /api/stats response. */
export interface EngramStats {
  total_observations: number;
  total_sessions: number;
  projects?: string[];
}

/** Shape of Engram's search response. */
export interface EngramSearchResult {
  observations: EngramObservation[];
  total?: number;
}
