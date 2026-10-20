import { randomUUID } from 'node:crypto';
import type { ApiKey, ApiKeyRepository, NewApiKey } from '../modules/api-keys/api-key.js';

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  readonly keys: ApiKey[] = [];
  usageWrites = 0;

  create(key: NewApiKey): Promise<ApiKey> {
    const apiKey: ApiKey = {
      ...key,
      id: randomUUID(),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(Date.parse('2026-10-20T09:00:00Z') + this.keys.length),
    };
    this.keys.push(apiKey);
    return Promise.resolve({ ...apiKey });
  }

  findByPrefix(prefix: string): Promise<ApiKey | null> {
    const key = this.keys.find((item) => item.prefix === prefix);
    return Promise.resolve(key ? { ...key } : null);
  }

  findById(id: string): Promise<ApiKey | null> {
    const key = this.keys.find((item) => item.id === id);
    return Promise.resolve(key ? { ...key } : null);
  }

  list(): Promise<ApiKey[]> {
    return Promise.resolve(
      [...this.keys]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((key) => ({ ...key })),
    );
  }

  revoke(id: string, at: Date): Promise<boolean> {
    const key = this.keys.find((item) => item.id === id && item.revokedAt === null);
    if (key) key.revokedAt = at;
    return Promise.resolve(key !== undefined);
  }

  markUsed(id: string, at: Date): Promise<void> {
    const key = this.keys.find((item) => item.id === id);
    if (key) {
      key.lastUsedAt = at;
      this.usageWrites += 1;
    }
    return Promise.resolve();
  }
}
