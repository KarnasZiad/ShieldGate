import { sha256Hex } from '../../lib/crypto/tokens.js';

const MINUTE = 60_000;

/** Counters behind the lockout and stuffing rules (Redis in production). */
export interface LoginThrottleStore {
  isIpBlocked(ip: string): Promise<boolean>;
  accountFailures(accountKey: string): Promise<number>;
  /** Counts a failure for the account and adds the account to the set tried from this IP. */
  recordFailure(
    accountKey: string,
    ip: string,
    windows: { accountMs: number; ipMs: number },
  ): Promise<{ accountFailures: number; accountsTriedFromIp: number }>;
  clearAccount(accountKey: string): Promise<void>;
  blockIp(ip: string, durationMs: number): Promise<void>;
}

export interface LoginThrottleRules {
  maxAccountFailures: number;
  accountWindowMs: number;
  maxAccountsPerIp: number;
  stuffingWindowMs: number;
  ipBlockMs: number;
}

export const DEFAULT_THROTTLE_RULES: LoginThrottleRules = {
  maxAccountFailures: 5,
  accountWindowMs: 15 * MINUTE,
  maxAccountsPerIp: 10,
  stuffingWindowMs: 10 * MINUTE,
  ipBlockMs: 60 * MINUTE,
};

export type ThrottleVerdict = 'allowed' | 'account_locked' | 'ip_blocked';

/**
 * Brute force and credential stuffing protection (threats S1, S2).
 *
 * - Account lockout: 5 failures in 15 minutes lock the account for the rest of the window.
 * - Stuffing: an IP failing on more than 10 distinct accounts in 10 minutes is blocked for an hour.
 *
 * Accounts are keyed by the SHA-256 of the normalized e-mail: Redis never holds e-mail addresses.
 */
export class LoginThrottle {
  constructor(
    private readonly store: LoginThrottleStore,
    private readonly rules: LoginThrottleRules = DEFAULT_THROTTLE_RULES,
  ) {}

  static accountKey(email: string): string {
    return sha256Hex(email.trim().toLowerCase());
  }

  async check(email: string, ip: string): Promise<ThrottleVerdict> {
    if (await this.store.isIpBlocked(ip)) return 'ip_blocked';
    const failures = await this.store.accountFailures(LoginThrottle.accountKey(email));
    return failures >= this.rules.maxAccountFailures ? 'account_locked' : 'allowed';
  }

  async onFailure(
    email: string,
    ip: string,
  ): Promise<{ lockedNow: boolean; ipBlockedNow: boolean }> {
    const { accountFailures, accountsTriedFromIp } = await this.store.recordFailure(
      LoginThrottle.accountKey(email),
      ip,
      { accountMs: this.rules.accountWindowMs, ipMs: this.rules.stuffingWindowMs },
    );
    const ipBlockedNow = accountsTriedFromIp > this.rules.maxAccountsPerIp;
    if (ipBlockedNow) {
      await this.store.blockIp(ip, this.rules.ipBlockMs);
    }
    return { lockedNow: accountFailures === this.rules.maxAccountFailures, ipBlockedNow };
  }

  async onSuccess(email: string): Promise<void> {
    await this.store.clearAccount(LoginThrottle.accountKey(email));
  }

  /** Administrative unlock (threat D2: lockouts are temporary and reversible). */
  async unlock(email: string): Promise<void> {
    await this.store.clearAccount(LoginThrottle.accountKey(email));
  }
}
