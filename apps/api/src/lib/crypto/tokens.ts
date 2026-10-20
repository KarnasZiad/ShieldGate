import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Cryptographically random token, URL-safe. 32 bytes = 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(value: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

/** Constant-time comparison: the time taken does not reveal how many leading bytes match. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function safeEqualStrings(a: string, b: string): boolean {
  return safeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
