import type { Redis } from 'ioredis';
import { randomToken } from '../../lib/crypto/tokens.js';
import type { MfaChallenge, MfaChallengeStore } from './mfa-challenge.js';

const challengeKey = (id: string) => `sg:mfa:challenge:${id}`;

export class RedisMfaChallengeStore implements MfaChallengeStore {
  constructor(private readonly redis: Redis) {}

  async create(userId: string, ttlMs: number): Promise<string> {
    const id = randomToken(32);
    await this.redis
      .multi()
      .hset(challengeKey(id), { userId, attempts: 0 })
      .pexpire(challengeKey(id), ttlMs)
      .exec();
    return id;
  }

  async attempt(id: string): Promise<MfaChallenge | null> {
    const results = await this.redis
      .multi()
      .hget(challengeKey(id), 'userId')
      .hincrby(challengeKey(id), 'attempts', 1)
      .exec();
    const userId = results?.[0]?.[1];
    if (typeof userId !== 'string') {
      // HINCRBY created an orphan hash for an unknown id: remove it.
      await this.redis.del(challengeKey(id));
      return null;
    }
    return { userId, attempts: Number(results?.[1]?.[1] ?? 0) };
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(challengeKey(id));
  }
}
