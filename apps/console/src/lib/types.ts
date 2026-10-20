/** Shapes returned by the ShieldGate API (OpenAPI document at /docs). */

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

export interface AuthenticatedSession {
  status: 'authenticated';
  user: SessionUser;
  csrfToken: string;
  mfa: boolean;
  expiresAt: string;
}

export type LoginResponse =
  AuthenticatedSession | { status: 'mfa_required'; challengeId: string; expiresIn: number };

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  roles: string[];
  mfaEnabled: boolean;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SessionView {
  id: string;
  current: boolean;
  ip: string;
  userAgent: string;
  mfa: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface Role {
  name: string;
  description: string;
  permissions: string[];
}

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  ownerId: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Policy {
  id: string;
  description: string;
  effect: 'allow' | 'deny';
  actions: string[];
  resources: string[];
  roles: string[];
  condition?: unknown;
}

export interface Decision {
  decision: 'allow' | 'deny';
  policyId: string | null;
  reason: 'deny_policy' | 'allow_policy' | 'no_matching_policy';
}

export interface AuditRecord {
  id: string;
  '@timestamp': string;
  event: { action: string; category: string[]; outcome: 'success' | 'failure'; reason?: string };
  user?: { id?: string; email?: string; target?: { id: string; email?: string } };
  source?: { ip: string };
  labels?: Record<string, string>;
}

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
  expiresInSeconds: number;
}
