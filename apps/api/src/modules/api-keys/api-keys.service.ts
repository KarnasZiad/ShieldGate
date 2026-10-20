import type { Clock } from '../../lib/clock.js';
import { hmacSha256, safeEqual } from '../../lib/crypto/tokens.js';
import { problems } from '../../lib/problem.js';
import type { ApiKeyPrincipal } from '../../plugins/authenticate.js';
import { AuditAction } from '../audit/audit-event.js';
import type { AuditLogger } from '../audit/audit-logger.js';
import type { Actor } from '../users/users.service.js';
import {
  type ApiKey,
  type ApiKeyRepository,
  type ApiKeyScope,
  generateApiKey,
  parseApiKey,
} from './api-key.js';

const DAY_MS = 86_400_000;
/** last_used_at is informative: one write per minute per key is enough. */
const USAGE_WRITE_INTERVAL_MS = 60_000;

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  expiresInDays?: number;
}

export class ApiKeysService {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly pepper: Buffer,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  /** Returns the full key once; afterwards only its HMAC exists (threat I1). */
  async create(input: CreateApiKeyInput, actor: Actor): Promise<{ key: string; apiKey: ApiKey }> {
    const { key, prefix, secret } = generateApiKey();
    const apiKey = await this.keys.create({
      ownerId: actor.id,
      name: input.name,
      prefix,
      secretHmac: hmacSha256(secret, this.pepper),
      scopes: input.scopes,
      expiresAt: input.expiresInDays
        ? new Date(this.clock.now() + input.expiresInDays * DAY_MS)
        : null,
    });
    this.audit.record({
      action: AuditAction.ApiKeyCreated,
      outcome: 'success',
      user: { id: actor.id, email: actor.email },
      labels: { key_id: apiKey.id, prefix, scopes: input.scopes.join(',') },
      ...auditContext(actor),
    });
    return { key, apiKey };
  }

  list(): Promise<ApiKey[]> {
    return this.keys.list();
  }

  async revoke(id: string, actor: Actor): Promise<void> {
    const revoked = await this.keys.revoke(id, new Date(this.clock.now()));
    if (!revoked) throw problems.notFound('API key not found or already revoked');
    this.audit.record({
      action: AuditAction.ApiKeyRevoked,
      outcome: 'success',
      user: { id: actor.id, email: actor.email },
      labels: { key_id: id },
      ...auditContext(actor),
    });
  }

  /** Resolves a bearer token. Every failure looks the same to the caller. */
  async authenticate(token: string): Promise<ApiKeyPrincipal | null> {
    const parsed = parseApiKey(token);
    if (!parsed) return null;
    const apiKey = await this.keys.findByPrefix(parsed.prefix);
    if (!apiKey) return null;

    // Always compute and compare the HMAC before looking at revocation or expiry.
    const matches = safeEqual(hmacSha256(parsed.secret, this.pepper), apiKey.secretHmac);
    const now = this.clock.now();
    const usable =
      matches &&
      apiKey.revokedAt === null &&
      (apiKey.expiresAt === null || apiKey.expiresAt.getTime() > now);
    if (!usable) return null;

    if (!apiKey.lastUsedAt || now - apiKey.lastUsedAt.getTime() >= USAGE_WRITE_INTERVAL_MS) {
      await this.keys.markUsed(apiKey.id, new Date(now));
    }
    return {
      kind: 'api-key',
      keyId: apiKey.id,
      name: apiKey.name,
      ownerId: apiKey.ownerId,
      scopes: apiKey.scopes,
    };
  }
}

function auditContext(actor: Actor) {
  return {
    ...(actor.ip ? { ip: actor.ip } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    ...(actor.requestId ? { requestId: actor.requestId } : {}),
  };
}
