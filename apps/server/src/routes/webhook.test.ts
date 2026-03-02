import { describe, it, expect } from 'vitest';
import { createWebhookRouter } from './webhook.js';

describe('webhook router', () => {
  it('exports createWebhookRouter as a function', () => {
    expect(createWebhookRouter).toBeTypeOf('function');
  });
});
