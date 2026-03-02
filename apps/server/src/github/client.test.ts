import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from './client.js';

/**
 * Helper: compute a valid sha256 HMAC signature in GitHub's format.
 */
function computeSignature(payload: string, secret: string): string {
  const hash = createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hash}`;
}

describe('verifyWebhookSignature', () => {
  const secret = 'test-webhook-secret';
  const payload = '{"action":"opened"}';

  it('returns true for a valid signature', async () => {
    const signature = computeSignature(payload, secret);
    expect(await verifyWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it('returns false for null signature', async () => {
    expect(await verifyWebhookSignature(payload, null, secret)).toBe(false);
  });

  it('returns false for signature without sha256= prefix', async () => {
    const hash = createHmac('sha256', secret).update(payload).digest('hex');
    // No prefix — just the raw hex
    expect(await verifyWebhookSignature(payload, hash, secret)).toBe(false);
    // Wrong prefix
    expect(await verifyWebhookSignature(payload, `sha1=${hash}`, secret)).toBe(false);
  });

  it('returns false for tampered payload', async () => {
    const signature = computeSignature(payload, secret);
    const tampered = '{"action":"closed"}';
    expect(await verifyWebhookSignature(tampered, signature, secret)).toBe(false);
  });

  it('returns false for wrong secret', async () => {
    const signature = computeSignature(payload, secret);
    expect(await verifyWebhookSignature(payload, signature, 'wrong-secret')).toBe(false);
  });

  it('returns false for empty signature string', async () => {
    expect(await verifyWebhookSignature(payload, '', secret)).toBe(false);
  });

  it('handles UTF-8 payloads correctly', async () => {
    const utf8Payload = '{"title":"Revisión de código — ñ, ü, 日本語"}';
    const signature = computeSignature(utf8Payload, secret);
    expect(await verifyWebhookSignature(utf8Payload, signature, secret)).toBe(true);
  });

  it('handles large payloads', async () => {
    const largePayload = '{"data":"' + 'x'.repeat(100_000) + '"}';
    const signature = computeSignature(largePayload, secret);
    expect(await verifyWebhookSignature(largePayload, signature, secret)).toBe(true);
  });

  it('returns false for non-hex signature content', async () => {
    expect(await verifyWebhookSignature(payload, 'sha256=not-valid-hex!', secret)).toBe(false);
  });
});
