export type UserStatus = 'active' | 'disabled';

/** Internal representation: never serialized as is (it holds the password hash and TOTP seed). */
export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: UserStatus;
  roles: string[];
  totpSecret: Buffer | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  roles: string[];
  mfaEnabled: boolean;
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roles: user.roles,
    mfaEnabled: user.totpEnabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

export interface NewUser {
  email: string;
  displayName: string;
  passwordHash: string;
  roles: string[];
}

export interface UserPage {
  items: User[];
  nextCursor: string | null;
}

export interface UserListQuery {
  cursor?: string;
  limit: number;
  search?: string;
}

export interface TotpState {
  secret: Buffer | null;
  enabledAt: Date | null;
  lastStep: number | null;
}

export class EmailTakenError extends Error {
  constructor() {
    super('An account already uses this e-mail address');
    this.name = 'EmailTakenError';
  }
}

export class UnknownRoleError extends Error {
  constructor(readonly roles: string[]) {
    super(`Unknown role(s): ${roles.join(', ')}`);
    this.name = 'UnknownRoleError';
  }
}

export interface UserRepository {
  create(user: NewUser): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  list(query: UserListQuery): Promise<UserPage>;
  update(id: string, changes: { displayName?: string; status?: UserStatus }): Promise<User | null>;
  setRoles(id: string, roles: string[]): Promise<User | null>;
  setTotp(id: string, state: TotpState): Promise<void>;
  /**
   * Atomically records a used TOTP step, only if it is newer than the last one. Returns false when
   * another request already used this step or a later one (replay protection under concurrency).
   */
  recordTotpStep(id: string, step: number): Promise<boolean>;
}

export interface Role {
  name: string;
  description: string;
  permissions: string[];
}

export interface RoleRepository {
  list(): Promise<Role[]>;
}
