import { problems } from '../../lib/problem.js';
import { AuditAction } from '../audit/audit-event.js';
import type { AuditLogger } from '../audit/audit-logger.js';
import { checkPassword } from './password-policy.js';
import type { PasswordHasher } from './password-hasher.js';
import {
  EmailTakenError,
  UnknownRoleError,
  type User,
  type UserListQuery,
  type UserPage,
  type UserRepository,
  type UserStatus,
} from './user.js';

/** Who performs an administrative action: recorded in the audit trail (threat R1). */
export interface Actor {
  id: string;
  email: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/** Implemented by the session store: disabling an account or changing its roles logs it out. */
export interface SessionRevoker {
  revokeAllForUser(userId: string): Promise<number>;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
  roles: string[];
}

export interface UpdateUserInput {
  displayName?: string;
  status?: UserStatus;
  roles?: string[];
}

function auditContext(actor: Actor) {
  return {
    ...(actor.ip ? { ip: actor.ip } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    ...(actor.requestId ? { requestId: actor.requestId } : {}),
  };
}

export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionRevoker,
    private readonly audit: AuditLogger,
  ) {}

  async create(input: CreateUserInput, actor: Actor): Promise<User> {
    const passwordProblems = checkPassword(input.password, input);
    if (passwordProblems.length > 0) {
      throw problems.unprocessable('The password does not meet the policy', {
        problems: passwordProblems,
      });
    }
    try {
      const user = await this.users.create({
        email: input.email,
        displayName: input.displayName,
        passwordHash: await this.hasher.hash(input.password),
        roles: input.roles,
      });
      this.audit.record({
        action: AuditAction.UserCreated,
        outcome: 'success',
        user: { id: actor.id, email: actor.email, target: { id: user.id, email: user.email } },
        labels: { roles: user.roles.join(',') },
        ...auditContext(actor),
      });
      return user;
    } catch (error) {
      throw translate(error);
    }
  }

  list(query: UserListQuery): Promise<UserPage> {
    return this.users.list(query);
  }

  async get(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw problems.notFound('User not found');
    return user;
  }

  async update(id: string, input: UpdateUserInput, actor: Actor): Promise<User> {
    if (id === actor.id && (input.status === 'disabled' || input.roles !== undefined)) {
      // Prevents an administrator from locking everyone out by mistake.
      throw problems.forbidden('You cannot disable your own account or change your own roles');
    }
    const before = await this.get(id);
    try {
      let user = before;
      if (input.displayName !== undefined || input.status !== undefined) {
        user = (await this.users.update(id, input)) ?? user;
      }
      if (input.roles !== undefined) {
        user = (await this.users.setRoles(id, input.roles)) ?? user;
      }

      const rolesChanged = before.roles.join(',') !== user.roles.join(',');
      const disabled = before.status === 'active' && user.status === 'disabled';
      if (rolesChanged || disabled) {
        // Sessions carry a snapshot of the roles: they must not outlive a privilege change.
        await this.sessions.revokeAllForUser(id);
      }

      this.audit.record({
        action: AuditAction.UserUpdated,
        outcome: 'success',
        user: { id: actor.id, email: actor.email, target: { id: user.id, email: user.email } },
        labels: {
          changes: Object.keys(input).sort().join(','),
          status: user.status,
          roles: user.roles.join(','),
        },
        ...auditContext(actor),
      });
      return user;
    } catch (error) {
      throw translate(error);
    }
  }
}

function translate(error: unknown): unknown {
  if (error instanceof EmailTakenError) return problems.conflict(error.message);
  if (error instanceof UnknownRoleError) {
    return problems.unprocessable(error.message, { roles: error.roles });
  }
  return error;
}
