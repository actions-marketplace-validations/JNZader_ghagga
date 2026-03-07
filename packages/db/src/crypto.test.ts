import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto.js';

const TEST_KEY = randomBytes(32).toString('hex');

describe('crypto', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('should encrypt and decrypt a string roundtrip', () => {
    const plaintext = 'sk-ant-api03-my-secret-key-12345';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
    expect(encrypted).not.toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same-key-twice';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it('should handle empty string', () => {
    const encrypted = encrypt('');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  it('should handle unicode characters', () => {
    const plaintext = '🔑 mi clave secreta con ñ y émojis 🚀';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should handle long strings', () => {
    const plaintext = 'a'.repeat(10_000);
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should throw on tampered ciphertext', () => {
    const encrypted = encrypt('secret');
    const buf = Buffer.from(encrypted, 'base64');
    // Flip a byte in the ciphertext portion
    buf[15] = buf[15]! ^ 0xff;
    const tampered = buf.toString('base64');

    expect(() => decrypt(tampered)).toThrow();
  });

  it('should throw on truncated ciphertext', () => {
    expect(() => decrypt('dG9vc2hvcnQ=')).toThrow('Invalid encrypted data: too short');
  });

  it('should throw with different encryption key', () => {
    const encrypted = encrypt('secret');
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');

    expect(() => decrypt(encrypted)).toThrow();
  });

  it('should throw when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY environment variable is not set');
  });

  it('should throw when ENCRYPTION_KEY is invalid length', () => {
    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be exactly 64 hex characters');
  });

  it('should throw when ENCRYPTION_KEY has non-hex chars', () => {
    process.env.ENCRYPTION_KEY = 'g'.repeat(64);
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be exactly 64 hex characters');
  });
});
