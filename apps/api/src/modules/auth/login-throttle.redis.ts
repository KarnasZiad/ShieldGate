import type { Redis } from 'ioredis';
import type { LoginThrottleStore } from './login-throttle.js';

const failuresKey = (accountKey: string) => `sg:login:fail:${accountKey}`;
const accountsKey = (ip: string) => `sg:login:accounts:${ip}`;
const blockKey = (ip: string) => `sg:ip-block:${ip}`;

/**
 * Fixed windows starting at the first failure (PEXPIRE ... NX). Distinct accounts per IP are
 * counted with a HyperLogLog: constant memory however many accounts an attacker tries.
 */
export class RedisLoginThrottleStore implements LoginThrottleStore {
  constructor(private readonly redis: Redis) {}

  async isIpBlocked(ip: string): Promise<boolean> {
    return (await this.redis.exists(blockKey(ip))) === 1;
  }

  async accountFailures(accountKey: string): Promise<number> {
    return Number((await this.redis.get(failuresKey(accountKey))) ?? 0);
  }

  async recordFailure(
    accountKey: string,
    ip: string,
    windows: { accountMs: number; ipMs: number },
  ): Promise<{ accountFailures: number; accountsTriedFromIp: number }> {
    const results = await this.redis
      .multi()
      .incr(failuresKey(accountKey))
      .pexpire(failuresKey(accountKey), windows.accountMs, 'NX')
      .pfadd(accountsKey(ip), accountKey)
      .pexpire(accountsKey(ip), windows.ipMs, 'NX')
      .pfcount(accountsKey(ip))
      .exec();
    return {
      accountFailures: Number(results?.[0]?.[1] ?? 0),
      accountsTriedFromIp: Number(results?.[4]?.[1] ?? 0),
    };
  }

  async clearAccount(accountKey: string): Promise<void> {
    await this.redis.del(failuresKey(accountKey));
  }

  async blockIp(ip: string, durationMs: number): Promise<void> {
    await this.redis.set(blockKey(ip), '1', 'PX', durationMs);
  }
}
