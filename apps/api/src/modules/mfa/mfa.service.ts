import { randomBytes } from 'node:crypto';
import { base32Encode } from '../../lib/base32.js';
import type { Clock } from '../../lib/clock.js';
import type { SecretBox } from '../../lib/crypto/secret-box.js';
import type { EphemeralStore } from '../../lib/ephemeral-store.js';
import { problems } from '../../lib/problem.js';
import { otpauthUri, verifyTotp } from '../../lib/totp.js';
import { AuditAction } from '../audit/audit-event.js';
import type { AuditLogger } from '../audit/audit-logger.js';
import type { ClientInfo } from '../auth/auth.service.js';
import type { PasswordHasher } from '../users/password-hasher.js';
import type { UserRepository } from '../users/user.js';

/** 160 bits, the size recommended by RFC 4226 for HMAC-SHA1. */
const SECRET_BYTES = 20;
const SETUP_TTL_MS = 10 * 60_000;
const ISSUER = 'ShieldGate';

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
  expiresInSeconds: number;
}

export interface MfaServiceDeps {
  users: UserRepository;
  pendingSetups: EphemeralStore;
  secretBox: SecretBox;
  hasher: PasswordHasher;
  audit: AuditLogger;
  clock: Clock;
}

/**
 * TOTP enrollment: a pending secret (sealed even in Redis) is activated only once the user proves
 * their authenticator produces valid codes. Disabling MFA requires the password again.
 */
export class MfaService {
  constructor(private readonly deps: MfaServiceDeps) {}

  async beginTotpSetup(userId: string): Promise<TotpEnrollment> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw problems.unauthorized('Account not found');
    if (user.totpEnabledAt) throw problems.conflict('Two-factor authentication is already enabled');

    const secret = randomBytes(SECRET_BYTES);
    await this.deps.pendingSetups.set(
      userId,
      this.deps.secretBox.seal(secret).toString('base64'),
      SETUP_TTL_MS,
    );
    const secretBase32 = base32Encode(secret, { padding: false });
    return {
      secret: secretBase32,
      otpauthUri: otpauthUri({ secretBase32, account: user.email, issuer: ISSUER }),
      expiresInSeconds: SETUP_TTL_MS / 1000,
    };
  }

  async activateTotp(userId: string, code: string, client: ClientInfo): Promise<void> {
    const { users, pendingSetups, secretBox, clock, audit } = this.deps;
    const pending = await pendingSetups.get(userId);
    if (!pending) throw problems.unprocessable('No enrollment in progress, start again');

    const sealed = Buffer.from(pending, 'base64');
    const step = verifyTotp(secretBox.open(sealed), code, clock.now());
    if (step === null) throw problems.unprocessable('Invalid verification code');

    // The activation code is recorded as used: it cannot be replayed to sign in.
    await users.setTotp(userId, {
      secret: sealed,
      enabledAt: new Date(clock.now()),
      lastStep: step,
    });
    await pendingSetups.delete(userId);
    audit.record({
      action: AuditAction.MfaEnabled,
      outcome: 'success',
      user: { id: userId },
      ...client,
    });
  }

  async disableTotp(userId: string, password: string, client: ClientInfo): Promise<void> {
    const { users, hasher, audit } = this.deps;
    const user = await users.findById(userId);
    if (!user) throw problems.unauthorized('Account not found');
    if (!user.totpEnabledAt) throw problems.conflict('Two-factor authentication is not enabled');
    if (!(await hasher.verify(user.passwordHash, password))) {
      audit.record({
        action: AuditAction.MfaDisabled,
        outcome: 'failure',
        reason: 'invalid_password',
        user: { id: user.id, email: user.email },
        ...client,
      });
      throw problems.forbidden('Password confirmation failed');
    }
    await users.setTotp(userId, { secret: null, enabledAt: null, lastStep: null });
    audit.record({
      action: AuditAction.MfaDisabled,
      outcome: 'success',
      user: { id: user.id, email: user.email },
      ...client,
    });
  }
}
