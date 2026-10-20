import type { SessionRevoker } from '../users/users.service.js';

export interface NewSession {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  /** Snapshot of the role permissions: sessions are revoked when roles change. */
  permissions: string[];
  mfa: boolean;
  ip: string;
  userAgent: string;
}

export interface Session extends NewSession {
  /** SHA-256 of the session id: safe to show and to use as a key (it cannot authenticate). */
  handle: string;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
}

export interface SessionLifetime {
  idleMs: number;
  absoluteMs: number;
}

export interface SessionStore extends SessionRevoker {
  /** Creates a session with a fresh 256-bit id; only its hash is stored. */
  create(input: NewSession): Promise<{ id: string; session: Session }>;
  /** Resolves a cookie value, slides the idle timeout and enforces the absolute lifetime. */
  touch(id: string): Promise<Session | null>;
  get(handle: string): Promise<Session | null>;
  list(userId: string): Promise<Session[]>;
  revoke(handle: string): Promise<Session | null>;
}

/** Remaining time to live: the idle timeout, capped by the absolute lifetime. */
export function remainingTtl(session: Session, now: number, lifetime: SessionLifetime): number {
  return Math.min(lifetime.idleMs, session.absoluteExpiresAt - now);
}

export const SESSION_REVOKED_CHANNEL = 'sg:sessions:revoked';
