/**
 * SQLite-backed memory storage using sql.js (pure WASM).
 *
 * Thread safety: This class is NOT thread-safe. It operates as an in-memory
 * database with manual file persistence via close(). Designed for single-process
 * environments (CLI, GitHub Action).
 */

import initSqlJs, { type Database } from 'fts5-sql-bundle';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemoryStorage, MemoryObservationRow } from '../types.js';

/**
 * Extended Database interface — fts5-sql-bundle types omit the params overload
 * for exec(), but the runtime (sql.js core) supports it.
 */
interface DatabaseWithParams extends Database {
  exec(sql: string, params?: (string | number | null)[]): Array<{ columns: string[]; values: unknown[][] }>;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS memory_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    pr_number INTEGER,
    summary TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS memory_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES memory_sessions(id),
    project TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    topic_key TEXT,
    file_paths TEXT DEFAULT '[]',
    content_hash TEXT,
    revision_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_obs_project ON memory_observations(project);
  CREATE INDEX IF NOT EXISTS idx_obs_topic_key ON memory_observations(topic_key);
  CREATE INDEX IF NOT EXISTS idx_obs_content_hash ON memory_observations(content_hash);

  CREATE VIRTUAL TABLE IF NOT EXISTS memory_observations_fts
    USING fts5(title, content, content='memory_observations', content_rowid='id');

  CREATE TRIGGER IF NOT EXISTS obs_fts_insert AFTER INSERT ON memory_observations BEGIN
    INSERT INTO memory_observations_fts(rowid, title, content)
      VALUES (new.id, new.title, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS obs_fts_update AFTER UPDATE ON memory_observations BEGIN
    INSERT INTO memory_observations_fts(memory_observations_fts, rowid, title, content)
      VALUES ('delete', old.id, old.title, old.content);
    INSERT INTO memory_observations_fts(rowid, title, content)
      VALUES (new.id, new.title, new.content);
  END;
`;

const DEDUP_WINDOW_MINUTES = 15;

export class SqliteMemoryStorage implements MemoryStorage {
  private constructor(
    private db: DatabaseWithParams,
    private filePath: string,
  ) {}

  /**
   * Async factory — handles WASM initialization and file loading.
   * If filePath exists, loads the existing DB. Otherwise, creates a fresh one.
   */
  static async create(filePath: string): Promise<SqliteMemoryStorage> {
    const SQL = await initSqlJs();

    let db: DatabaseWithParams;
    if (existsSync(filePath)) {
      const buffer = readFileSync(filePath);
      db = new SQL.Database(buffer) as DatabaseWithParams;
    } else {
      db = new SQL.Database() as DatabaseWithParams;
    }

    db.run(SCHEMA_SQL);

    return new SqliteMemoryStorage(db, filePath);
  }

  async searchObservations(
    project: string,
    query: string,
    options: { limit?: number; type?: string } = {},
  ): Promise<MemoryObservationRow[]> {
    const { limit = 10, type } = options;

    // Convert space-separated keywords to FTS5 OR query
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => `"${w.replace(/"/g, '""')}"`)
      .join(' OR ');

    if (!ftsQuery) return [];

    let sql = `
      SELECT o.id, o.type, o.title, o.content, o.file_paths
      FROM memory_observations o
      JOIN memory_observations_fts fts ON fts.rowid = o.id
      WHERE memory_observations_fts MATCH ?
        AND o.project = ?
    `;
    const params: (string | number)[] = [ftsQuery, project];

    if (type) {
      sql += ' AND o.type = ?';
      params.push(type);
    }

    sql += ' ORDER BY bm25(memory_observations_fts) LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const rows: MemoryObservationRow[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        id: row['id'] as number,
        type: row['type'] as string,
        title: row['title'] as string,
        content: row['content'] as string,
        filePaths: row['file_paths'] ? JSON.parse(row['file_paths'] as string) : null,
      });
    }
    stmt.free();

    return rows;
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
    const contentHash = createHash('sha256')
      .update(`${data.type}:${data.title}:${data.content}`)
      .digest('hex');

    // Dedup: check for same content hash within 15-minute window
    const dedupRows = this.db.exec(`
      SELECT id, type, title, content, file_paths FROM memory_observations
      WHERE content_hash = ? AND project = ?
        AND created_at > datetime('now', '-${DEDUP_WINDOW_MINUTES} minutes')
      LIMIT 1
    `, [contentHash, data.project]);

    if (dedupRows.length > 0 && dedupRows[0]!.values.length > 0) {
      const row = dedupRows[0]!.values[0]!;
      return {
        id: row[0] as number,
        type: row[1] as string,
        title: row[2] as string,
        content: row[3] as string,
        filePaths: row[4] ? JSON.parse(row[4] as string) : null,
      };
    }

    // TopicKey upsert
    if (data.topicKey) {
      const existingByTopic = this.db.exec(`
        SELECT id FROM memory_observations
        WHERE topic_key = ? AND project = ?
        LIMIT 1
      `, [data.topicKey, data.project]);

      if (existingByTopic.length > 0 && existingByTopic[0]!.values.length > 0) {
        const existingId = existingByTopic[0]!.values[0]![0] as number;
        const filePathsJson = JSON.stringify(data.filePaths ?? []);

        const updated = this.db.exec(`
          UPDATE memory_observations
          SET content = ?, title = ?, content_hash = ?, file_paths = ?,
              revision_count = revision_count + 1,
              updated_at = datetime('now')
          WHERE id = ?
          RETURNING id, type, title, content, file_paths
        `, [data.content, data.title, contentHash, filePathsJson, existingId]);

        const row = updated[0]!.values[0]!;
        return {
          id: row[0] as number,
          type: row[1] as string,
          title: row[2] as string,
          content: row[3] as string,
          filePaths: row[4] ? JSON.parse(row[4] as string) : null,
        };
      }
    }

    // New observation
    const filePathsJson = JSON.stringify(data.filePaths ?? []);
    const inserted = this.db.exec(`
      INSERT INTO memory_observations
        (session_id, project, type, title, content, topic_key, file_paths, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, type, title, content, file_paths
    `, [
      data.sessionId ?? null,
      data.project,
      data.type,
      data.title,
      data.content,
      data.topicKey ?? null,
      filePathsJson,
      contentHash,
    ]);

    const row = inserted[0]!.values[0]!;
    return {
      id: row[0] as number,
      type: row[1] as string,
      title: row[2] as string,
      content: row[3] as string,
      filePaths: row[4] ? JSON.parse(row[4] as string) : null,
    };
  }

  async createSession(data: {
    project: string;
    prNumber?: number;
  }): Promise<{ id: number }> {
    const result = this.db.exec(`
      INSERT INTO memory_sessions (project, pr_number)
      VALUES (?, ?)
      RETURNING id
    `, [data.project, data.prNumber ?? null]);

    return { id: result[0]!.values[0]![0] as number };
  }

  async endSession(sessionId: number, summary: string): Promise<void> {
    this.db.run(`
      UPDATE memory_sessions
      SET ended_at = datetime('now'), summary = ?
      WHERE id = ?
    `, [summary, sessionId]);
  }

  async close(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data = this.db.export();
    writeFileSync(this.filePath, Buffer.from(data));
    this.db.close();
  }
}
