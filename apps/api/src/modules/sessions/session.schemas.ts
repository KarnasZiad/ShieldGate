import { z } from 'zod';
import type { Session } from './session.js';

export const SessionViewSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  ip: z.string(),
  userAgent: z.string(),
  mfa: z.boolean(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
});

export type SessionView = z.infer<typeof SessionViewSchema>;

/** The public handle (a hash) identifies the session; the session id itself is never returned. */
export function toSessionView(session: Session, currentHandle?: string): SessionView {
  return {
    id: session.handle,
    current: session.handle === currentHandle,
    ip: session.ip,
    userAgent: session.userAgent,
    mfa: session.mfa,
    createdAt: new Date(session.createdAt).toISOString(),
    lastSeenAt: new Date(session.lastSeenAt).toISOString(),
    expiresAt: new Date(session.absoluteExpiresAt).toISOString(),
  };
}

export const SessionHandleParamsSchema = z.object({ id: z.string().regex(/^[0-9a-f]{64}$/) });
