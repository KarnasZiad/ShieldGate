import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox, SecretBoxError } from './secret-box.js';

const keyOne = randomBytes(32);
const keyTwo = randomBytes(32);
const secret = Buffer.from('totp seed of 20 bytes');

describe('SecretBox', () => {
  it('round-trips a secret', () => {
    const box = new SecretBox({ 1: keyOne }, 1);

    expect(box.open(box.seal(secret))).toEqual(secret);
  });

  it('uses a fresh nonce for every encryption', () => {
    const box = new SecretBox({ 1: keyOne }, 1);

    expect(box.seal(secret).equals(box.seal(secret))).toBe(false);
  });

  it('detects any tampering with the ciphertext, the tag or the header', () => {
    const box = new SecretBox({ 1: keyOne, 2: keyTwo }, 1);
    const sealed = box.seal(secret);

    for (const index of [0, 1, 5, 20, sealed.length - 1]) {
      const tampered = Buffer.from(sealed);
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      expect(() => box.open(tampered)).toThrow(SecretBoxError);
    }
  });

  it('keeps old secrets readable after a key rotation', () => {
    const before = new SecretBox({ 1: keyOne }, 1);
    const after = new SecretBox({ 1: keyOne, 2: keyTwo }, 2);
    const sealedWithOldKey = before.seal(secret);

    expect(after.open(sealedWithOldKey)).toEqual(secret);
    expect(after.needsRotation(sealedWithOldKey)).toBe(true);
    expect(after.needsRotation(after.seal(secret))).toBe(false);
  });

  it('refuses values sealed with a key it does not know', () => {
    const other = new SecretBox({ 2: keyTwo }, 2);

    expect(() => new SecretBox({ 1: keyOne }, 1).open(other.seal(secret))).toThrow(
      'Unknown key id 2',
    );
  });

  it('validates its configuration and inputs', () => {
    expect(() => new SecretBox({ 1: randomBytes(16) }, 1)).toThrow('must be 32 bytes long');
    expect(() => new SecretBox({ 1: keyOne }, 2)).toThrow('Unknown current key id 2');
    expect(() => new SecretBox({ 0: keyOne }, 0)).toThrow('Invalid key id 0');
    expect(() => new SecretBox({ 1: keyOne }, 1).open(Buffer.alloc(10))).toThrow('too short');
  });
});
