/**
 * Audit event in an Elastic Common Schema (ECS) shape, so it can be exported to a SIEM as is.
 * `user` is the actor; `user.target` is the account the action applies to.
 */
export type AuditOutcome = 'success' | 'failure';

export const AuditAction = {
  Login: 'user.login',
  Logout: 'user.logout',
  AccountLocked: 'user.locked',
  AccountUnlocked: 'user.unlocked',
  IpBlocked: 'security.ip_blocked',
  MfaEnabled: 'user.mfa_enabled',
  MfaDisabled: 'user.mfa_disabled',
  SessionRevoked: 'session.revoked',
  UserCreated: 'user.created',
  UserUpdated: 'user.updated',
  ApiKeyCreated: 'api_key.created',
  ApiKeyRevoked: 'api_key.revoked',
  PolicyChanged: 'policy.changed',
  AuthorizationDecision: 'authz.decision',
} as const;

export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

const CATEGORIES: Record<AuditActionName, string[]> = {
  'user.login': ['authentication'],
  'user.logout': ['authentication', 'session'],
  'user.locked': ['authentication', 'iam'],
  'user.unlocked': ['iam'],
  'security.ip_blocked': ['authentication', 'intrusion_detection'],
  'user.mfa_enabled': ['iam'],
  'user.mfa_disabled': ['iam'],
  'session.revoked': ['session'],
  'user.created': ['iam'],
  'user.updated': ['iam'],
  'api_key.created': ['iam'],
  'api_key.revoked': ['iam'],
  'policy.changed': ['configuration', 'iam'],
  'authz.decision': ['iam'],
};

export interface AuditUser {
  id?: string;
  email?: string;
  target?: { id: string; email?: string };
}

export interface AuditEvent {
  '@timestamp': Date;
  event: { action: AuditActionName; category: string[]; outcome: AuditOutcome; reason?: string };
  user?: AuditUser;
  source?: { ip: string };
  user_agent?: { original: string };
  trace?: { id: string };
  labels?: Record<string, string>;
}

/** What callers provide; the logger adds the timestamp and the ECS categories. */
export interface AuditInput {
  action: AuditActionName;
  outcome: AuditOutcome;
  reason?: string;
  user?: AuditUser;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  labels?: Record<string, string>;
}

export function toAuditEvent(input: AuditInput, timestamp: Date): AuditEvent {
  return {
    '@timestamp': timestamp,
    event: {
      action: input.action,
      category: CATEGORIES[input.action],
      outcome: input.outcome,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    ...(input.user ? { user: input.user } : {}),
    ...(input.ip ? { source: { ip: input.ip } } : {}),
    ...(input.userAgent ? { user_agent: { original: input.userAgent.slice(0, 512) } } : {}),
    ...(input.requestId ? { trace: { id: input.requestId } } : {}),
    ...(input.labels ? { labels: input.labels } : {}),
  };
}

export interface AuditSearch {
  action?: AuditActionName;
  userId?: string;
  outcome?: AuditOutcome;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

export interface AuditRecord extends AuditEvent {
  id: string;
}

export interface AuditPage {
  items: AuditRecord[];
  nextCursor: string | null;
}

/** Destination of the audit trail (MongoDB in production). */
export interface AuditSink {
  write(events: readonly AuditEvent[]): Promise<void>;
}

export interface AuditQuery {
  search(query: AuditSearch): Promise<AuditPage>;
}
