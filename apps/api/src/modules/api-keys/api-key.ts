import { randomBytes } from 'node:crypto';
import { base32Encode } from '../../lib/base32.js';

export const API_KEY_SCOPES = ['authorize'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface ApiKey {
  id: string;
  ownerId: string;
  name: string;
  prefix: string;
  secretHmac: Buffer;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export type NewApiKey = Pick<
  ApiKey,
  'ownerId' | 'name' | 'prefix' | 'secretHmac' | 'scopes' | 'expiresAt'
>;

export interface ApiKeyRepository {
  create(key: NewApiKey): Promise<ApiKey>;
  findByPrefix(prefix: string): Promise<ApiKey | null>;
  findById(id: string): Promise<ApiKey | null>;
  list(): Promise<ApiKey[]>;
  revoke(id: string, at: Date): Promise<boolean>;
  markUsed(id: string, at: Date): Promise<void>;
}

const KEY_FORMAT = /^sg_live_([a-z2-7]{8})_([A-Za-z0-9_-]{43})$/;

/** Format: sg_live_<8-char public prefix>_<256-bit secret>. Easy to spot in leaked code. */
export function generateApiKey(): { key: string; prefix: string; secret: string } {
  const prefix = base32Encode(randomBytes(5), { padding: false }).toLowerCase();
  const secret = randomBytes(32).toString('base64url');
  return { key: `sg_live_${prefix}_${secret}`, prefix, secret };
}

export function parseApiKey(key: string): { prefix: string; secret: string } | null {
  const match = KEY_FORMAT.exec(key);
  return match?.[1] && match[2] ? { prefix: match[1], secret: match[2] } : null;
}
