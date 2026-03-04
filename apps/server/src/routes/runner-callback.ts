/**
 * Runner callback route.
 *
 * Receives static analysis results from the GitHub Actions runner
 * and forwards them to the Inngest function via event emission.
 *
 * Security: Validates HMAC-SHA256 signature to prevent callback forgery.
 */

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { inngest } from '../inngest/client.js';
import { logger as rootLogger } from '../lib/logger.js';

const logger = rootLogger.child({ module: 'runner-callback' });

interface CallbackBody {
  callbackId: string;
  staticAnalysis: {
    semgrep: { status: string; findings: unknown[]; error?: string; executionTimeMs: number };
    trivy: { status: string; findings: unknown[]; error?: string; executionTimeMs: number };
    cpd: { status: string; findings: unknown[]; error?: string; executionTimeMs: number };
  };
}

export function createRunnerCallbackRouter() {
  const router = new Hono();

  router.post('/api/runner-callback', async (c) => {
    // 1. Extract signature header
    const signature = c.req.header('X-Ghagga-Signature');
    if (!signature) {
      logger.warn('Callback rejected: missing X-Ghagga-Signature header');
      return c.json({ error: 'Missing signature' }, 401);
    }

    // 2. Parse body
    let body: CallbackBody;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    if (!body.callbackId || !body.staticAnalysis) {
      return c.json({ error: 'Missing required fields: callbackId, staticAnalysis' }, 400);
    }

    // 3. Verify HMAC signature
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!webhookSecret) {
      logger.error('GITHUB_WEBHOOK_SECRET not configured');
      return c.json({ error: 'Server misconfigured' }, 500);
    }

    const expectedSignature = 'sha256=' + createHmac('sha256', webhookSecret)
      .update(body.callbackId)
      .digest('hex');

    try {
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
        logger.warn({ callbackId: body.callbackId }, 'Callback rejected: invalid HMAC signature');
        return c.json({ error: 'Invalid signature' }, 401);
      }
    } catch {
      logger.warn({ callbackId: body.callbackId }, 'Callback rejected: signature comparison failed');
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // 4. Emit Inngest event to resume the waiting review function
    await inngest.send({
      name: 'ghagga/runner.completed',
      data: {
        callbackId: body.callbackId,
        staticAnalysis: body.staticAnalysis,
      },
    });

    logger.info({ callbackId: body.callbackId }, 'Runner callback accepted');
    return c.json({ status: 'accepted' }, 200);
  });

  return router;
}
