import type pg from 'pg';
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
} from './user.js';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: UserStatus;
  roles: string[];
  totp_secret: Buffer | null;
  totp_enabled_at: Date | null;
  totp_last_step: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_USER = `
  SELECT u.*, COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id`;

const UNIQUE_VIOLATION = '23505';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    status: row.status,
    roles: row.roles,
    totpSecret: row.totp_secret,
    totpEnabledAt: row.totp_enabled_at,
    totpLastStep: row.totp_last_step === null ? null : Number(row.totp_last_step),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encodeCursor(user: User): string {
  return Buffer.from(`${user.createdAt.toISOString()}|${user.id}`).toString('base64url');
}

function decodeCursor(cursor: string): [string, string] {
  const [createdAt = '', id = ''] = Buffer.from(cursor, 'base64url').toString().split('|');
  return [createdAt, id];
}

/** Escapes LIKE wildcards so a search for "50%" does not match everything. */
function likePattern(search: string): string {
  return `%${search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(user: NewUser): Promise<User> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
        [user.email, user.displayName, user.passwordHash],
      );
      const id = inserted.rows[0]?.id ?? '';
      await this.replaceRoles(client, id, user.roles);
      await client.query('COMMIT');
      const created = await this.findById(id);
      if (!created) throw new Error('The inserted user could not be read back');
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new EmailTakenError();
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      `${SELECT_USER} WHERE u.id = $1 GROUP BY u.id`,
      [id],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      `${SELECT_USER} WHERE u.email = $1 GROUP BY u.id`,
      [email],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async list({ cursor, limit, search }: UserListQuery): Promise<UserPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      params.push(likePattern(search));
      conditions.push(
        `(u.email ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`,
      );
    }
    if (cursor) {
      const [createdAt, id] = decodeCursor(cursor);
      params.push(createdAt, id);
      conditions.push(
        `(u.created_at, u.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    params.push(limit + 1);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query<UserRow>(
      `${SELECT_USER} ${where} GROUP BY u.id ORDER BY u.created_at DESC, u.id DESC LIMIT $${params.length}`,
      params,
    );
    const items = rows.slice(0, limit).map(toUser);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
  }

  async update(
    id: string,
    changes: { displayName?: string; status?: UserStatus },
  ): Promise<User | null> {
    const { rowCount } = await this.pool.query(
      `UPDATE users
       SET display_name = COALESCE($2, display_name), status = COALESCE($3, status), updated_at = now()
       WHERE id = $1`,
      [id, changes.displayName ?? null, changes.status ?? null],
    );
    return rowCount ? this.findById(id) : null;
  }

  async setRoles(id: string, roles: string[]): Promise<User | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [id]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
      await this.replaceRoles(client, id, roles);
      await client.query('UPDATE users SET updated_at = now() WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.findById(id);
  }

  async setTotp(id: string, state: TotpState): Promise<void> {
    await this.pool.query(
      `UPDATE users SET totp_secret = $2, totp_enabled_at = $3, totp_last_step = $4, updated_at = now()
       WHERE id = $1`,
      [id, state.secret, state.enabledAt, state.lastStep],
    );
  }

  async recordTotpStep(id: string, step: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE users SET totp_last_step = $2
       WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
      [id, step],
    );
    return rowCount === 1;
  }

  private async replaceRoles(
    client: pg.PoolClient,
    userId: string,
    roles: string[],
  ): Promise<void> {
    if (roles.length === 0) return;
    const { rows } = await client.query<{ name: string }>(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = ANY($2::text[])
       RETURNING (SELECT name FROM roles WHERE roles.id = role_id)`,
      [userId, roles],
    );
    const granted = new Set(rows.map((row) => row.name));
    const unknown = roles.filter((role) => !granted.has(role));
    if (unknown.length > 0) throw new UnknownRoleError(unknown);
  }
}

export class PostgresRoleRepository implements RoleRepository {
  constructor(private readonly pool: pg.Pool) {}

  async list(): Promise<Role[]> {
    const { rows } = await this.pool.query<Role>(
      'SELECT name, description, permissions FROM roles ORDER BY name',
    );
    return rows;
  }
}
