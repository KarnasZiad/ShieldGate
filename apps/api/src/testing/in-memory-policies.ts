import type { Policy } from '../modules/authorization/policy.js';
import type { PolicyRepository } from '../modules/authorization/policy-repository.js';

export class InMemoryPolicyRepository implements PolicyRepository {
  readonly policies = new Map<string, Policy>();
  reads = 0;

  list(): Promise<Policy[]> {
    this.reads += 1;
    return Promise.resolve([...this.policies.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  upsert(policy: Policy): Promise<boolean> {
    const created = !this.policies.has(policy.id);
    this.policies.set(policy.id, structuredClone(policy));
    return Promise.resolve(created);
  }

  delete(id: string): Promise<boolean> {
    return Promise.resolve(this.policies.delete(id));
  }
}
