import type {
  MemoryStorage,
  MemoryObservationRow,
  MemoryObservationDetail,
  MemoryStats,
  ListObservationsOptions,
} from 'ghagga-core';
import {
  searchObservations,
  saveObservation,
  createMemorySession,
  endMemorySession,
} from 'ghagga-db';
import type { Database } from 'ghagga-db';

/**
 * PostgreSQL-backed memory storage.
 * Thin adapter wrapping existing ghagga-db query functions.
 *
 * The constructor receives the Drizzle Database instance; each method
 * delegates to the corresponding ghagga-db function and maps the full
 * Drizzle row to the MemoryObservationRow subset expected by core.
 *
 * close() is a no-op — the PostgreSQL connection lifecycle is managed
 * externally by the server (pooled via node-postgres).
 */
export class PostgresMemoryStorage implements MemoryStorage {
  constructor(private db: Database) {}

  async searchObservations(
    project: string,
    query: string,
    options?: { limit?: number; type?: string },
  ): Promise<MemoryObservationRow[]> {
    const rows = await searchObservations(this.db, project, query, options);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      filePaths: row.filePaths ?? null,
    }));
  }

  async saveObservation(data: {
    sessionId?: number;
    project: string;
    type: string;
    title: string;
    content: string;
    topicKey?: string;
    filePaths?: string[];
  }): Promise<MemoryObservationRow> {
    const row = await saveObservation(this.db, data);
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      filePaths: row.filePaths ?? null,
    };
  }

  async createSession(data: {
    project: string;
    prNumber?: number;
  }): Promise<{ id: number }> {
    const session = await createMemorySession(this.db, data);
    return { id: session.id };
  }

  async endSession(sessionId: number, summary: string): Promise<void> {
    await endMemorySession(this.db, sessionId, summary);
  }

  async close(): Promise<void> {
    // No-op — PostgreSQL connection lifecycle is managed externally
  }

  // ── Management method stubs (R5) ──────────────────────────────
  // These will be implemented via the Dashboard UI in a future change.

  async listObservations(options?: ListObservationsOptions): Promise<MemoryObservationDetail[]> {
    throw new Error('Not implemented — use Dashboard for memory management');
  }

  async getObservation(id: number): Promise<MemoryObservationDetail | null> {
    throw new Error('Not implemented — use Dashboard for memory management');
  }

  async deleteObservation(id: number): Promise<boolean> {
    throw new Error('Not implemented — use Dashboard for memory management');
  }

  async getStats(): Promise<MemoryStats> {
    throw new Error('Not implemented — use Dashboard for memory management');
  }

  async clearObservations(options?: { project?: string }): Promise<number> {
    throw new Error('Not implemented — use Dashboard for memory management');
  }
}
