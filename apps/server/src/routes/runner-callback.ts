/**
 * Runner callback route.
 *
 * Receives static analysis results from the GitHub Actions runner
 * workflow. Authenticates via per-dispatch HMAC signatures
 * (not the user session auth middleware).
 *
 * POST /runner/callback
 *
 * Headers:
 *   x-ghagga-signature: sha256=<hex>   — HMAC of raw body using per-dispatch secret
 *
 * Body (JSON):
 *   callbackId: string
 *   repoFullName: string
 *   prNumber: number
 *   headSha: string
 *   staticAnalysis: StaticAnalysisResult
 */

import { Hono } from 'hono';
import { verifyAndConsumeSecret } from '../github/runner.js';
import { inngest } from '../inngest/client.js';
import { logger as rootLogger } from '../lib/logger.js';
import type { StaticAnalysisResult } from 'ghagga-core';

const logger = rootLogger.child({ module: 'runner-callback' });

interface CallbackPayload {
  callbackId: string;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  staticAnalysis: StaticAnalysisResult;
}

export function createRunnerCallbackRouter() {
  const router = new Hono();

  router.post('/runner/callback', async (c) => {
    // Read raw body for HMAC verification
    const rawBody = await c.req.text();

    // Parse the body
    let payload: CallbackPayload;
    try {
      payload = JSON.parse(rawBody) as CallbackPayload;
    } catch {
      logger.warn('Runner callback: invalid JSON body');
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // Validate required fields
    const { callbackId, repoFullName, prNumber, headSha, staticAnalysis } = payload;
    if (!callbackId || !repoFullName || !prNumber || !headSha || !staticAnalysis) {
      logger.warn({ callbackId }, 'Runner callback: missing required fields');
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Verify HMAC signature using per-dispatch secret
    const signature = c.req.header('x-ghagga-signature');
    if (!signature) {
      logger.warn({ callbackId }, 'Runner callback: missing x-ghagga-signature header');
      return c.json({ error: 'Missing signature' }, 401);
    }

    const valid = verifyAndConsumeSecret(callbackId, rawBody, signature);
    if (!valid) {
      logger.warn({ callbackId }, 'Runner callback: HMAC verification failed');
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Send Inngest event to resume the waiting review function
    await inngest.send({
      name: 'ghagga/runner.completed',
      data: {
        callbackId,
        repoFullName,
        prNumber,
        headSha,
        staticAnalysis,
      },
    });

    logger.info(
      { callbackId, repoFullName, prNumber },
      'Runner callback accepted — dispatched Inngest event',
    );

    return c.json({ ok: true });
  });

  return router;
}
