import { hash, verify } from '@node-rs/argon2';

/** OWASP Password Storage Cheat Sheet: Argon2id (library default), 19 MiB, 2 iterations, 1 lane. */
const ARGON2ID_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password.normalize('NFKC'), ARGON2ID_OPTIONS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password.normalize('NFKC'));
  }

  /** Same cost as a real check, for unknown accounts: timing does not reveal existence (S3). */
  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('shieldgate-timing-equalizer');
    await verify(await this.dummyHash, password);
  }
}
