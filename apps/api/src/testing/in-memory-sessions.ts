import type { Clock } from '../lib/clock.js';
import { randomToken, sha256Hex } from '../lib/crypto/tokens.js';
import {
  type NewSession,
  remainingTtl,
  type Session,
  type SessionLifetime,
  type SessionStore,
} from '../modules/sessions/session.js';

/** Same expiry rules as RedisSessionStore, driven by the injected clock. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, { session: Session; expiresAt: number }>();
  readonly revoked: string[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly lifetime: SessionLifetime,
  ) {}

  create(input: NewSession): Promise<{ id: string; session: Session }> {
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
    this.sessions.set(session.handle, {
      session,
      expiresAt: now + remainingTtl(session, now, this.lifetime),
    });
    return Promise.resolve({ id, session: { ...session } });
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
    this.sessions.set(session.handle, {
      session: touched,
      expiresAt: now + remainingTtl(touched, now, this.lifetime),
    });
    return touched;
  }

  get(handle: string): Promise<Session | null> {
    const entry = this.sessions.get(handle);
    if (!entry || entry.expiresAt <= this.clock.now()) {
      this.sessions.delete(handle);
      return Promise.resolve(null);
    }
    return Promise.resolve({ ...entry.session });
  }

  async list(userId: string): Promise<Session[]> {
    const sessions = await Promise.all([...this.sessions.keys()].map((handle) => this.get(handle)));
    return sessions
      .filter((session): session is Session => session?.userId === userId)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  async revoke(handle: string): Promise<Session | null> {
    const session = await this.get(handle);
    if (session) {
      this.sessions.delete(handle);
      this.revoked.push(handle);
    }
    return session;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const sessions = await this.list(userId);
    await Promise.all(sessions.map((session) => this.revoke(session.handle)));
    return sessions.length;
  }
}
