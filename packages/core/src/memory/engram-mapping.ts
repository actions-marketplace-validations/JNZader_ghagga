/**
 * Schema mapping between GHAGGA observation types and Engram API shapes.
 *
 * GHAGGA stores severity, filePaths, and a source marker as structured
 * text within Engram's `content` field:
 *
 *   [severity:high]
 *   <actual content>
 *   ---
 *   Files: path/a.ts, path/b.ts
 *   ---
 *   Source: ghagga
 *
 * On read, the mapping functions parse this structure back out.
 * If the content doesn't match (e.g., an observation created by another tool),
 * sensible defaults are used.
 */

import type { MemoryObservationDetail, MemoryObservationRow } from '../types.js';
import type { EngramObservation } from './engram-types.js';

// ─── Types for the save payload ─────────────────────────────────

export interface EngramSavePayload {
  type: string;
  title: string;
  content: string;
  project?: string;
  topic_key?: string;
  scope?: string;
}

// ─── GHAGGA → Engram ────────────────────────────────────────────

/**
 * Encode GHAGGA-specific fields into a single Engram `content` string.
 *
 * - Prepends `[severity:xxx]` if severity is provided
 * - Appends `\n---\nFiles: path1, path2` if filePaths are provided
 * - Always appends `\n---\nSource: ghagga` as a footer
 */
export function toEngramContent(data: {
  content: string;
  severity?: string | null;
  filePaths?: string[] | null;
}): string {
  const parts: string[] = [];

  if (data.severity) {
    parts.push(`[severity:${data.severity}]`);
  }

  parts.push(data.content);

  if (data.filePaths && data.filePaths.length > 0) {
    parts.push('---');
    parts.push(`Files: ${data.filePaths.join(', ')}`);
  }

  parts.push('---');
  parts.push('Source: ghagga');

  return parts.join('\n');
}

/**
 * Parse GHAGGA-structured content back into its component fields.
 *
 * Extracts `[severity:xxx]` from the first line, `Files: ...` from the
 * footer section, and returns the clean content without metadata.
 *
 * If the content doesn't match the expected structure, returns it
 * as-is with null severity and filePaths.
 */
export function fromEngramContent(content: string): {
  content: string;
  severity: string | null;
  filePaths: string[] | null;
} {
  let severity: string | null = null;
  let filePaths: string[] | null = null;
  let body = content;

  // Extract [severity:xxx] from the first line
  const severityMatch = body.match(/^\[severity:(\w+)\]\n?/);
  if (severityMatch) {
    severity = severityMatch[1] ?? null;
    body = body.slice(severityMatch[0].length);
  }

  // Extract footer sections (delimited by ---) from the end
  // Look for "Source: ghagga" footer to confirm this is GHAGGA-structured
  const sourceFooterIdx = body.lastIndexOf('\n---\nSource: ghagga');
  if (sourceFooterIdx !== -1) {
    const beforeSource = body.slice(0, sourceFooterIdx);

    // Look for "Files: ..." section before the Source footer
    const filesFooterIdx = beforeSource.lastIndexOf('\n---\nFiles: ');
    if (filesFooterIdx !== -1) {
      const filesLine = beforeSource.slice(filesFooterIdx + '\n---\nFiles: '.length);
      filePaths = filesLine
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
      body = beforeSource.slice(0, filesFooterIdx);
    } else {
      body = beforeSource;
    }
  }

  return { content: body, severity, filePaths };
}

// ─── Engram → GHAGGA ────────────────────────────────────────────

/**
 * Map an Engram observation to GHAGGA's MemoryObservationRow.
 *
 * Uses `fromEngramContent()` to extract severity/filePaths from the
 * content field. The Engram ID (string | number) is converted to a
 * stable numeric ID via parseInt or a simple hash.
 */
export function toMemoryObservationRow(obs: EngramObservation): MemoryObservationRow {
  const parsed = fromEngramContent(obs.content);

  return {
    id: toNumericId(obs.id),
    type: obs.type ?? 'observation',
    title: obs.title ?? '',
    content: parsed.content,
    filePaths: parsed.filePaths,
    severity: parsed.severity,
  };
}

/**
 * Map an Engram observation to GHAGGA's MemoryObservationDetail.
 *
 * Full mapping including metadata fields (project, topicKey, timestamps, etc.).
 */
export function toMemoryObservationDetail(obs: EngramObservation): MemoryObservationDetail {
  const parsed = fromEngramContent(obs.content);

  return {
    id: toNumericId(obs.id),
    type: obs.type ?? 'observation',
    title: obs.title ?? '',
    content: parsed.content,
    filePaths: parsed.filePaths,
    severity: parsed.severity,
    project: obs.project ?? '',
    topicKey: obs.topic_key ?? null,
    revisionCount: obs.revision_count ?? 1,
    createdAt: obs.created_at ?? new Date().toISOString(),
    updatedAt: obs.updated_at ?? obs.created_at ?? new Date().toISOString(),
  };
}

/**
 * Map GHAGGA save data to the Engram save request payload.
 *
 * Uses `toEngramContent()` to embed severity/filePaths in the content field.
 */
export function toEngramSaveData(data: {
  sessionId?: number;
  project: string;
  type: string;
  title: string;
  content: string;
  topicKey?: string;
  filePaths?: string[];
  severity?: string;
}): EngramSavePayload {
  return {
    type: data.type,
    title: data.title,
    content: toEngramContent({
      content: data.content,
      severity: data.severity,
      filePaths: data.filePaths,
    }),
    project: data.project,
    topic_key: data.topicKey,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Convert an Engram ID (string or number) to a stable numeric ID.
 *
 * - If the ID is already a number, return it directly.
 * - If the ID is a numeric string, parse it.
 * - Otherwise, hash the string to a positive 32-bit integer.
 */
function toNumericId(id: string | number): number {
  if (typeof id === 'number') return id;

  const parsed = parseInt(id, 10);
  if (!Number.isNaN(parsed)) return parsed;

  // Simple hash for UUID/string IDs → positive 32-bit integer
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
