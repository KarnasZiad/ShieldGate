import { describe, expect, it } from 'vitest';
import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes with Argon2id and the OWASP parameters', async () => {
    await expect(hasher.hash('correct horse battery staple')).resolves.toMatch(
      /^[$]argon2id[$]v=19[$]m=19456,t=2,p=1[$]/,
    );
  });

  it('verifies only the right password', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'correct horse battery stapl')).resolves.toBe(false);
  });

  it('normalizes Unicode so the same passphrase typed differently still matches', async () => {
    const composed = 'café au lait du matin';
    const decomposed = composed.normalize('NFD');
    const hash = await hasher.hash(composed);

    await expect(hasher.verify(hash, decomposed)).resolves.toBe(true);
  });

  it('spends a full verification on unknown accounts', async () => {
    await expect(hasher.verifyAgainstDummy('anything')).resolves.toBeUndefined();
  });
});
