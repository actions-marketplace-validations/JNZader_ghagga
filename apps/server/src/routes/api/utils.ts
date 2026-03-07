/**
 * Shared helpers for the dashboard API routes.
 */

import type { DbProviderChainEntry } from 'ghagga-db';
import { decrypt } from 'ghagga-db';
import { logger as rootLogger } from '../../lib/logger.js';

export const logger = rootLogger.child({ module: 'api' });

/**
 * Mask an API key for safe display.
 * Shows the first 3 chars and last 4 chars: "sk-...xxxx"
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '***';
  const prefix = key.slice(0, 3);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Build a safe provider chain view for API responses.
 * Decrypts and masks API keys — never exposes raw encrypted values.
 */
export function buildProviderChainView(chain: DbProviderChainEntry[]) {
  return chain.map((entry) => ({
    provider: entry.provider,
    model: entry.model,
    hasApiKey: entry.encryptedApiKey != null,
    maskedApiKey: entry.encryptedApiKey ? maskApiKey(decrypt(entry.encryptedApiKey)) : undefined,
  }));
}
