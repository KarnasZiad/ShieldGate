import type { Clock } from '../../lib/clock.js';
import type { Policy } from './policy.js';

export interface PolicyRepository {
  list(): Promise<Policy[]>;
  /** Returns true when the policy was created, false when it replaced an existing one. */
  upsert(policy: Policy, updatedBy: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

/**
 * Keeps the decision path off the database (target: p95 < 20 ms). Writes through this instance
 * invalidate the cache at once; other instances converge within the TTL.
 */
export class CachedPolicySource {
  private cached: { policies: Policy[]; loadedAt: number } | null = null;

  constructor(
    private readonly repository: PolicyRepository,
    private readonly clock: Clock,
    private readonly ttlMs = 5_000,
  ) {}

  async all(): Promise<Policy[]> {
    const now = this.clock.now();
    if (!this.cached || now - this.cached.loadedAt >= this.ttlMs) {
      this.cached = { policies: await this.repository.list(), loadedAt: now };
    }
    return this.cached.policies;
  }

  invalidate(): void {
    this.cached = null;
  }
}
