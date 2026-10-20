import type pg from 'pg';
import type { ApiKey, ApiKeyRepository, ApiKeyScope, NewApiKey } from './api-key.js';

interface ApiKeyRow {
  id: string;
  owner_id: string;
  name: string;
  prefix: string;
  secret_hmac: Buffer;
  scopes: ApiKeyScope[];
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    prefix: row.prefix,
    secretHmac: row.secret_hmac,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export class PostgresApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(key: NewApiKey): Promise<ApiKey> {
    const { rows } = await this.pool.query<ApiKeyRow>(
      `INSERT INTO api_keys (owner_id, name, prefix, secret_hmac, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [key.ownerId, key.name, key.prefix, key.secretHmac, key.scopes, key.expiresAt],
    );
    const row = rows[0];
    if (!row) throw new Error('The inserted API key could not be read back');
    return toApiKey(row);
  }

  async findByPrefix(prefix: string): Promise<ApiKey | null> {
    const { rows } = await this.pool.query<ApiKeyRow>('SELECT * FROM api_keys WHERE prefix = $1', [
      prefix,
    ]);
    return rows[0] ? toApiKey(rows[0]) : null;
  }

  async findById(id: string): Promise<ApiKey | null> {
    const { rows } = await this.pool.query<ApiKeyRow>('SELECT * FROM api_keys WHERE id = $1', [id]);
    return rows[0] ? toApiKey(rows[0]) : null;
  }

  async list(): Promise<ApiKey[]> {
    const { rows } = await this.pool.query<ApiKeyRow>(
      'SELECT * FROM api_keys ORDER BY created_at DESC LIMIT 500',
    );
    return rows.map(toApiKey);
  }

  async revoke(id: string, at: Date): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'UPDATE api_keys SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL',
      [id, at],
    );
    return rowCount === 1;
  }

  async markUsed(id: string, at: Date): Promise<void> {
    await this.pool.query('UPDATE api_keys SET last_used_at = $2 WHERE id = $1', [id, at]);
  }
}
