import { describe, expect, it } from 'vitest';
import { stripPrivateData } from './privacy.js';

describe('stripPrivateData', () => {
  it('redacts Anthropic API keys (sk-ant-...)', () => {
    const text = 'key = sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890';
    const result = stripPrivateData(text);
    expect(result).toContain('[REDACTED_ANTHROPIC_KEY]');
    expect(result).not.toContain('sk-ant-api03');
  });

  it('redacts OpenAI API keys (sk-...)', () => {
    const text = 'OPENAI_KEY=sk-proj1234567890abcdefghijklmn';
    const result = stripPrivateData(text);
    expect(result).toContain('[REDACTED_OPENAI_KEY]');
    expect(result).not.toContain('sk-proj1234567890');
  });

  it('redacts OpenAI sk-proj-* keys with internal hyphens', () => {
    // Newer OpenAI keys use sk-proj-<org>-<random> format with hyphens
    const text = 'OPENAI_KEY=sk-proj-abc123-def456-ghi789-jkl012mno345pqr678';
    const result = stripPrivateData(text);
    expect(result).toContain('[REDACTED_OPENAI_KEY]');
    expect(result).not.toContain('sk-proj-abc123');
    expect(result).not.toContain('jkl012mno345pqr678');
  });

  it('redacts AWS Access Key IDs (AKIA...)', () => {
    const text = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
    const result = stripPrivateData(text);
    expect(result).toContain('[REDACTED_AWS_KEY]');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts GitHub PATs (ghp_, gho_, ghs_, github_pat_)', () => {
    const ghp = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl';
    expect(stripPrivateData(ghp)).toContain('[REDACTED_GITHUB_PAT]');

    const gho = 'token: gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl';
    expect(stripPrivateData(gho)).toContain('[REDACTED_GITHUB_OAUTH]');

    const ghs = 'token: ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl';
    expect(stripPrivateData(ghs)).toContain('[REDACTED_GITHUB_APP]');

    const pat = 'token: github_pat_ABCDEFGHIJKLMNOPQRSTUV_extra';
    expect(stripPrivateData(pat)).toContain('[REDACTED_GITHUB_FINE_PAT]');
  });

  it('redacts Google API keys (AIza...)', () => {
    // Construct at runtime to avoid triggering GitHub secret scanning
    const googleKey = 'AIza' + 'SyA1234567890abcdefghijklmnopqrstuv';
    const text = `google_key = ${googleKey}`;
    const result = stripPrivateData(text);
    expect(result).toContain('[REDACTED_GOOGLE_KEY]');
    expect(result).not.toContain('AIza');
  });

  it('redacts Slack tokens (xoxb-, xoxp-)', () => {
    // Construct tokens at runtime to avoid triggering GitHub push protection
    const xoxb = `SLACK_TOKEN=${['xoxb', '9998887776', 'fakeTestToken'].join('-')}`;
    expect(stripPrivateData(xoxb)).toContain('[REDACTED_SLACK_TOKEN]');

    const xoxp = `SLACK_TOKEN=${['xoxp', '9998887776', 'fakeTestToken'].join('-')}`;
    expect(stripPrivateData(xoxp)).toContain('[REDACTED_SLACK_TOKEN]');
  });

  it('redacts Bearer tokens in headers', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature_ok';
    const result = stripPrivateData(text);
    expect(result).toContain('Bearer [REDACTED');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('redacts password/secret/token assignments in quotes', () => {
    const text1 = 'password = "mySuperSecretPassword123"';
    expect(stripPrivateData(text1)).toContain('[REDACTED]');
    expect(stripPrivateData(text1)).not.toContain('mySuperSecretPassword123');

    const text2 = "secret: 'anotherLongSecretValue99'";
    expect(stripPrivateData(text2)).toContain('[REDACTED]');

    const text3 = 'api_key = "longapikey1234567890ab"';
    expect(stripPrivateData(text3)).toContain('[REDACTED]');
  });

  it('redacts PEM private keys', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF068wCKz',
      'PvkclYJEoLkNT3xKLNBcSU8GZF3sSuO3XAZT1K7B3gL3',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const result = stripPrivateData(pem);
    expect(result).toContain('[REDACTED_PRIVATE_KEY]');
    expect(result).not.toContain('MIIEpAIBAAKCAQEA');
  });

  it('redacts JWT tokens (eyJ...eyJ...xxx)', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = stripPrivateData(jwt);
    expect(result).toContain('[REDACTED_JWT]');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('does NOT redact normal text that looks similar but is not a key', () => {
    const normalText = 'The skeleton key was found in the drawer. The sk variable is defined.';
    const result = stripPrivateData(normalText);
    expect(result).toBe(normalText);
  });

  it('preserves surrounding text (only replaces the key portion)', () => {
    const text = 'Use this key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 for auth.';
    const result = stripPrivateData(text);
    expect(result).toContain('Use this key:');
    expect(result).toContain('for auth.');
    expect(result).toContain('[REDACTED_ANTHROPIC_KEY]');
  });

  it('handles text with multiple different secrets', () => {
    const text = [
      'ANTHROPIC_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890',
      'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
      'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl',
    ].join('\n');
    const result = stripPrivateData(text);
    expect(result).toContain('[REDACTED_ANTHROPIC_KEY]');
    expect(result).toContain('[REDACTED_AWS_KEY]');
    expect(result).toContain('[REDACTED_GITHUB_PAT]');
  });

  it('returns unchanged text when no secrets found', () => {
    const cleanText = 'function add(a: number, b: number): number {\n  return a + b;\n}';
    expect(stripPrivateData(cleanText)).toBe(cleanText);
  });
});
