import type { Redis } from 'ioredis';
import type { Clock } from './clock.js';

/** Short-lived key-value data (pending MFA enrollments...). Redis in production. */
export interface EphemeralStore {
  set(key: string, value: string, ttlMs: number): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export class RedisEphemeralStore implements EphemeralStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(`${this.prefix}${key}`, value, 'PX', ttlMs);
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(`${this.prefix}${key}`);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(`${this.prefix}${key}`);
  }
}

export class InMemoryEphemeralStore implements EphemeralStore {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly clock: Clock) {}

  set(key: string, value: string, ttlMs: number): Promise<void> {
    this.values.set(key, { value, expiresAt: this.clock.now() + ttlMs });
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    const entry = this.values.get(key);
    return Promise.resolve(entry && entry.expiresAt > this.clock.now() ? entry.value : null);
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}
