import type { Clock } from '../lib/clock.js';
import { randomToken } from '../lib/crypto/tokens.js';
import type { LoginThrottleStore } from '../modules/auth/login-throttle.js';
import type { MfaChallenge, MfaChallengeStore } from '../modules/auth/mfa-challenge.js';

interface Expiring<T> {
  value: T;
  expiresAt: number;
}

export class InMemoryLoginThrottleStore implements LoginThrottleStore {
  private readonly failures = new Map<string, Expiring<number>>();
  private readonly accountsByIp = new Map<string, Expiring<Set<string>>>();
  private readonly blockedIps = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  isIpBlocked(ip: string): Promise<boolean> {
    return Promise.resolve((this.blockedIps.get(ip) ?? 0) > this.clock.now());
  }

  accountFailures(accountKey: string): Promise<number> {
    return Promise.resolve(this.live(this.failures.get(accountKey))?.value ?? 0);
  }

  recordFailure(
    accountKey: string,
    ip: string,
    windows: { accountMs: number; ipMs: number },
  ): Promise<{ accountFailures: number; accountsTriedFromIp: number }> {
    const now = this.clock.now();
    const failures = this.live(this.failures.get(accountKey)) ?? {
      value: 0,
      expiresAt: now + windows.accountMs,
    };
    failures.value += 1;
    this.failures.set(accountKey, failures);
    const accounts = this.live(this.accountsByIp.get(ip)) ?? {
      value: new Set<string>(),
      expiresAt: now + windows.ipMs,
    };
    accounts.value.add(accountKey);
    this.accountsByIp.set(ip, accounts);
    return Promise.resolve({
      accountFailures: failures.value,
      accountsTriedFromIp: accounts.value.size,
    });
  }

  clearAccount(accountKey: string): Promise<void> {
    this.failures.delete(accountKey);
    return Promise.resolve();
  }

  blockIp(ip: string, durationMs: number): Promise<void> {
    this.blockedIps.set(ip, this.clock.now() + durationMs);
    return Promise.resolve();
  }

  private live<T>(entry: Expiring<T> | undefined): Expiring<T> | undefined {
    return entry && entry.expiresAt > this.clock.now() ? entry : undefined;
  }
}

export class InMemoryMfaChallengeStore implements MfaChallengeStore {
  private readonly challenges = new Map<string, Expiring<MfaChallenge>>();

  constructor(private readonly clock: Clock) {}

  create(userId: string, ttlMs: number): Promise<string> {
    const id = randomToken(32);
    this.challenges.set(id, {
      value: { userId, attempts: 0 },
      expiresAt: this.clock.now() + ttlMs,
    });
    return Promise.resolve(id);
  }

  attempt(id: string): Promise<MfaChallenge | null> {
    const entry = this.challenges.get(id);
    if (!entry || entry.expiresAt <= this.clock.now()) return Promise.resolve(null);
    entry.value.attempts += 1;
    return Promise.resolve({ ...entry.value });
  }

  delete(id: string): Promise<void> {
    this.challenges.delete(id);
    return Promise.resolve();
  }
}
