import type { Redis } from 'ioredis';
import type { Clock } from '../../lib/clock.js';
import { randomToken, sha256Hex } from '../../lib/crypto/tokens.js';
import {
  type NewSession,
  remainingTtl,
  type Session,
  SESSION_REVOKED_CHANNEL,
  type SessionLifetime,
  type SessionStore,
} from './session.js';

const sessionKey = (handle: string) => `sg:session:${handle}`;
const userSessionsKey = (userId: string) => `sg:user-sessions:${userId}`;

/**
 * Sessions live only in Redis (ADR 0002): deleting the key revokes the session on every API
 * instance at the next request. Revocations are also published for components caching sessions.
 */
export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly clock: Clock,
    private readonly lifetime: SessionLifetime,
  ) {}

  async create(input: NewSession): Promise<{ id: string; session: Session }> {
    const id = randomToken(32);
    const now = this.clock.now();
    const session: Session = {
      ...input,
      handle: sha256Hex(id),
      csrfToken: randomToken(32),
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + this.lifetime.absoluteMs,
    };
    await this.redis
      .multi()
      .set(
        sessionKey(session.handle),
        JSON.stringify(session),
        'PX',
        remainingTtl(session, now, this.lifetime),
      )
      .sadd(userSessionsKey(input.userId), session.handle)
      .pexpire(userSessionsKey(input.userId), this.lifetime.absoluteMs)
      .exec();
    return { id, session };
  }

  async touch(id: string): Promise<Session | null> {
    const session = await this.get(sha256Hex(id));
    if (!session) return null;
    const now = this.clock.now();
    if (now >= session.absoluteExpiresAt) {
      await this.revoke(session.handle);
      return null;
    }
    const touched = { ...session, lastSeenAt: now };
    // XX: never resurrect a session revoked by a concurrent request.
    const updated = await this.redis.set(
      sessionKey(session.handle),
      JSON.stringify(touched),
      'PX',
      remainingTtl(touched, now, this.lifetime),
      'XX',
    );
    return updated === 'OK' ? touched : null;
  }

  async get(handle: string): Promise<Session | null> {
    const raw = await this.redis.get(sessionKey(handle));
    return raw ? (JSON.parse(raw) as Session) : null;
  }

  async list(userId: string): Promise<Session[]> {
    const handles = await this.redis.smembers(userSessionsKey(userId));
    if (handles.length === 0) return [];
    const values = await this.redis.mget(handles.map(sessionKey));
    const expired = handles.filter((_, index) => values[index] === null);
    if (expired.length > 0) {
      await this.redis.srem(userSessionsKey(userId), ...expired);
    }
    return values
      .filter((value): value is string => value !== null)
      .map((value) => JSON.parse(value) as Session)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  async revoke(handle: string): Promise<Session | null> {
    const session = await this.get(handle);
    if (!session) return null;
    await this.redis
      .multi()
      .del(sessionKey(handle))
      .srem(userSessionsKey(session.userId), handle)
      .publish(SESSION_REVOKED_CHANNEL, handle)
      .exec();
    return session;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const handles = await this.redis.smembers(userSessionsKey(userId));
    const transaction = this.redis.multi().del(userSessionsKey(userId));
    for (const handle of handles) {
      transaction.del(sessionKey(handle)).publish(SESSION_REVOKED_CHANNEL, handle);
    }
    await transaction.exec();
    return handles.length;
  }
}
