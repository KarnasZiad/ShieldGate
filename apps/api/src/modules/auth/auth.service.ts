import type { Clock } from '../../lib/clock.js';
import type { SecretBox } from '../../lib/crypto/secret-box.js';
import { problems } from '../../lib/problem.js';
import { verifyTotp } from '../../lib/totp.js';
import { AuditAction, type AuditInput } from '../audit/audit-event.js';
import type { AuditLogger } from '../audit/audit-logger.js';
import type { Session, SessionStore } from '../sessions/session.js';
import type { PasswordHasher } from '../users/password-hasher.js';
import type { RoleRepository, User, UserRepository } from '../users/user.js';
import type { LoginThrottle } from './login-throttle.js';
import { MFA_CHALLENGE_TTL_MS, MFA_MAX_ATTEMPTS, type MfaChallengeStore } from './mfa-challenge.js';

const INVALID_CREDENTIALS = 'Invalid e-mail or password';

/** Request metadata recorded in the session and in the audit trail. */
export interface ClientInfo {
  ip: string;
  userAgent: string;
  requestId: string;
}

export type LoginResult =
  | { kind: 'session'; sessionId: string; session: Session }
  | { kind: 'mfa_required'; challengeId: string; expiresInSeconds: number };

export interface AuthServiceDeps {
  users: UserRepository;
  roles: RoleRepository;
  sessions: SessionStore;
  throttle: LoginThrottle;
  challenges: MfaChallengeStore;
  hasher: PasswordHasher;
  secretBox: SecretBox;
  audit: AuditLogger;
  clock: Clock;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(email: string, password: string, client: ClientInfo): Promise<LoginResult> {
    const { throttle, users, hasher } = this.deps;

    const verdict = await throttle.check(email, client.ip);
    if (verdict === 'ip_blocked') {
      this.record(client, {
        action: AuditAction.Login,
        outcome: 'failure',
        reason: 'ip_blocked',
        user: { email },
      });
      throw problems.tooManyRequests(
        'Too many failed sign-ins from your network. Try again later.',
      );
    }

    const user = await users.findByEmail(email);
    if (verdict === 'account_locked') {
      // Same answer and same cost as a wrong password: a lockout reveals nothing (threat S3).
      await hasher.verifyAgainstDummy(password);
      this.record(client, {
        action: AuditAction.Login,
        outcome: 'failure',
        reason: 'account_locked',
        user: { email },
      });
      throw problems.unauthorized(INVALID_CREDENTIALS);
    }

    let valid = false;
    if (user?.status === 'active') {
      valid = await hasher.verify(user.passwordHash, password);
    } else {
      await hasher.verifyAgainstDummy(password);
    }

    if (!user || !valid) {
      await this.onFailedPassword(email, user, client);
      throw problems.unauthorized(INVALID_CREDENTIALS);
    }

    await throttle.onSuccess(email);

    if (user.totpEnabledAt) {
      const challengeId = await this.deps.challenges.create(user.id, MFA_CHALLENGE_TTL_MS);
      return { kind: 'mfa_required', challengeId, expiresInSeconds: MFA_CHALLENGE_TTL_MS / 1000 };
    }
    return this.openSession(user, client, false);
  }

  async completeMfa(challengeId: string, code: string, client: ClientInfo): Promise<LoginResult> {
    const { challenges, users, secretBox, clock } = this.deps;

    const challenge = await challenges.attempt(challengeId);
    if (!challenge) throw problems.unauthorized('Invalid or expired verification');

    const user = await users.findById(challenge.userId);
    if (user?.status !== 'active' || !user.totpSecret || !user.totpEnabledAt) {
      await challenges.delete(challengeId);
      throw problems.unauthorized('Invalid or expired verification');
    }

    const step = verifyTotp(secretBox.open(user.totpSecret), code, clock.now(), {
      lastUsedStep: user.totpLastStep,
    });
    // The conditional update makes a code single-use even under concurrent requests (threat S5).
    if (step === null || !(await users.recordTotpStep(user.id, step))) {
      const exhausted = challenge.attempts >= MFA_MAX_ATTEMPTS;
      if (exhausted) await challenges.delete(challengeId);
      this.record(client, {
        action: AuditAction.Login,
        outcome: 'failure',
        reason: exhausted ? 'mfa_attempts_exhausted' : 'invalid_mfa_code',
        user: { id: user.id, email: user.email },
      });
      throw problems.unauthorized('Invalid verification code');
    }

    await challenges.delete(challengeId);
    return this.openSession(user, client, true);
  }

  async logout(session: Session, client: ClientInfo): Promise<void> {
    await this.deps.sessions.revoke(session.handle);
    this.record(client, {
      action: AuditAction.Logout,
      outcome: 'success',
      user: { id: session.userId, email: session.email },
    });
  }

  private async openSession(user: User, client: ClientInfo, mfa: boolean): Promise<LoginResult> {
    const roles = await this.deps.roles.list();
    const permissions = [
      ...new Set(
        roles.filter((role) => user.roles.includes(role.name)).flatMap((role) => role.permissions),
      ),
    ];
    const { id, session } = await this.deps.sessions.create({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      permissions,
      mfa,
      ip: client.ip,
      userAgent: client.userAgent.slice(0, 512),
    });
    this.record(client, {
      action: AuditAction.Login,
      outcome: 'success',
      user: { id: user.id, email: user.email },
      labels: { mfa: mfa ? 'totp' : 'none' },
    });
    return { kind: 'session', sessionId: id, session };
  }

  private async onFailedPassword(
    email: string,
    user: User | null,
    client: ClientInfo,
  ): Promise<void> {
    const { lockedNow, ipBlockedNow } = await this.deps.throttle.onFailure(email, client.ip);
    const subject = user ? { id: user.id, email: user.email } : { email };
    this.record(client, {
      action: AuditAction.Login,
      outcome: 'failure',
      reason: user?.status === 'disabled' ? 'account_disabled' : 'invalid_credentials',
      user: subject,
    });
    if (lockedNow) {
      this.record(client, { action: AuditAction.AccountLocked, outcome: 'success', user: subject });
    }
    if (ipBlockedNow) {
      this.record(client, {
        action: AuditAction.IpBlocked,
        outcome: 'success',
        reason: 'credential_stuffing',
      });
    }
  }

  private record(
    client: ClientInfo,
    input: Omit<AuditInput, 'ip' | 'userAgent' | 'requestId'>,
  ): void {
    this.deps.audit.record({
      ...input,
      ip: client.ip,
      userAgent: client.userAgent,
      requestId: client.requestId,
    });
  }
}
