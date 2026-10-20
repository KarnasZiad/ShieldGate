import { randomUUID } from 'node:crypto';
import {
  EmailTakenError,
  type NewUser,
  type Role,
  type RoleRepository,
  type TotpState,
  UnknownRoleError,
  type User,
  type UserListQuery,
  type UserPage,
  type UserRepository,
  type UserStatus,
} from '../modules/users/user.js';

export const DEFAULT_ROLES: Role[] = [
  { name: 'admin', description: 'Full administration', permissions: ['*'] },
  {
    name: 'security-analyst',
    description: 'Reads the audit trail',
    permissions: ['users:read', 'sessions:read', 'policies:read', 'audit:read'],
  },
  { name: 'member', description: 'Own account only', permissions: [] },
];

export class InMemoryRoleRepository implements RoleRepository {
  constructor(readonly roles: Role[] = DEFAULT_ROLES) {}

  list(): Promise<Role[]> {
    return Promise.resolve(this.roles);
  }
}

/** Same contract as PostgresUserRepository, including case-insensitive e-mail uniqueness. */
export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();
  private clock = Date.parse('2026-10-01T00:00:00Z');

  constructor(private readonly roles: InMemoryRoleRepository = new InMemoryRoleRepository()) {}

  create(input: NewUser): Promise<User> {
    if (
      [...this.users.values()].some(
        (user) => user.email.toLowerCase() === input.email.toLowerCase(),
      )
    ) {
      return Promise.reject(new EmailTakenError());
    }
    this.assertRoles(input.roles);
    this.clock += 1_000;
    const user: User = {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      status: 'active',
      roles: [...input.roles].sort(),
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      createdAt: new Date(this.clock),
      updatedAt: new Date(this.clock),
    };
    this.users.set(user.id, user);
    return Promise.resolve(structuredClone(user));
  }

  findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    return Promise.resolve(user ? structuredClone(user) : null);
  }

  findByEmail(email: string): Promise<User | null> {
    const user = [...this.users.values()].find(
      (item) => item.email.toLowerCase() === email.toLowerCase(),
    );
    return Promise.resolve(user ? structuredClone(user) : null);
  }

  list({ cursor, limit, search }: UserListQuery): Promise<UserPage> {
    const term = search?.toLowerCase();
    const sorted = [...this.users.values()]
      .filter(
        (user) =>
          !term ||
          user.email.toLowerCase().includes(term) ||
          user.displayName.toLowerCase().includes(term),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const start = cursor ? sorted.findIndex((user) => user.id === cursor) + 1 : 0;
    const page = sorted.slice(start, start + limit);
    const last = page.at(-1);
    return Promise.resolve({
      items: page.map((user) => structuredClone(user)),
      nextCursor: sorted.length > start + limit && last ? last.id : null,
    });
  }

  update(id: string, changes: { displayName?: string; status?: UserStatus }): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return Promise.resolve(null);
    Object.assign(user, {
      ...(changes.displayName ? { displayName: changes.displayName } : {}),
      ...(changes.status ? { status: changes.status } : {}),
    });
    return this.findById(id);
  }

  setRoles(id: string, roles: string[]): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return Promise.resolve(null);
    this.assertRoles(roles);
    user.roles = [...roles].sort();
    return this.findById(id);
  }

  setTotp(id: string, state: TotpState): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      user.totpSecret = state.secret;
      user.totpEnabledAt = state.enabledAt;
      user.totpLastStep = state.lastStep;
    }
    return Promise.resolve();
  }

  recordTotpStep(id: string, step: number): Promise<boolean> {
    const user = this.users.get(id);
    if (!user || (user.totpLastStep !== null && user.totpLastStep >= step)) {
      return Promise.resolve(false);
    }
    user.totpLastStep = step;
    return Promise.resolve(true);
  }

  private assertRoles(roles: string[]): void {
    const known = new Set(this.roles.roles.map((role) => role.name));
    const unknown = roles.filter((role) => !known.has(role));
    if (unknown.length > 0) throw new UnknownRoleError(unknown);
  }
}
