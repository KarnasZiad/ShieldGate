import { describe, expect, it } from 'vitest';
import { hmacSha256, randomToken, safeEqual, safeEqualStrings, sha256Hex } from './tokens.js';

describe('tokens', () => {
  it('generates URL-safe random tokens of the requested size', () => {
    const token = randomToken();

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(/^[\w-]+$/);
    expect(randomToken()).not.toBe(token);
  });

  it('hashes with SHA-256', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('computes HMAC-SHA256 (RFC 4231 test case 2)', () => {
    expect(hmacSha256('what do ya want for nothing?', Buffer.from('Jefe')).toString('hex')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('compares in constant time, including buffers of different lengths', () => {
    expect(safeEqual(Buffer.from('secret'), Buffer.from('secret'))).toBe(true);
    expect(safeEqual(Buffer.from('secret'), Buffer.from('secreT'))).toBe(false);
    expect(safeEqual(Buffer.from('secret'), Buffer.from('secret-longer'))).toBe(false);
    expect(safeEqualStrings('csrf-token', 'csrf-token')).toBe(true);
  });
});
