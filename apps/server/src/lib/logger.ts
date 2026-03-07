/**
 * Structured logger for the GHAGGA server.
 *
 * Uses pino for JSON structured logging. Render captures stdout
 * automatically, so no transport configuration needed.
 *
 * Usage:
 *   import { logger } from '@/lib/logger.js';
 *   logger.info({ repo: 'foo/bar', pr: 42 }, 'Review started');
 *   logger.error({ err }, 'Review failed');
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Redact sensitive fields from logs
  redact: {
    paths: ['req.headers.authorization', 'apiKey', 'encryptedApiKey', 'token', 'privateKey'],
    censor: '[REDACTED]',
  },
});

/**
 * Create a child logger with context (e.g., request ID, repo name).
 */
export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
