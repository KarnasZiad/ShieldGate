import type pg from 'pg';
import { type Policy, PolicySchema } from './policy.js';
import type { PolicyRepository } from './policy-repository.js';

interface PolicyRow {
  id: string;
  description: string;
  effect: 'allow' | 'deny';
  actions: string[];
  resources: string[];
  roles: string[];
  condition: unknown;
}

export class PostgresPolicyRepository implements PolicyRepository {
  constructor(private readonly pool: pg.Pool) {}

  async list(): Promise<Policy[]> {
    const { rows } = await this.pool.query<PolicyRow>(
      'SELECT id, description, effect, actions, resources, roles, condition FROM policies ORDER BY id',
    );
    // Validated again on the way out: a row edited by hand cannot inject an unknown operator.
    // An invalid row fails the whole read, so the decision point fails closed: skipping it could
    // silently drop a deny policy.
    return rows.map(({ condition, ...row }) => {
      const result = PolicySchema.safeParse(condition === null ? row : { ...row, condition });
      if (!result.success) {
        throw new Error(`Stored policy "${row.id}" is invalid: ${result.error.message}`);
      }
      return result.data;
    });
  }

  async upsert(policy: Policy, updatedBy: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ created: boolean }>(
      `INSERT INTO policies (id, description, effect, actions, resources, roles, condition, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         description = EXCLUDED.description, effect = EXCLUDED.effect, actions = EXCLUDED.actions,
         resources = EXCLUDED.resources, roles = EXCLUDED.roles, condition = EXCLUDED.condition,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING (xmax = 0) AS created`,
      [
        policy.id,
        policy.description,
        policy.effect,
        policy.actions,
        policy.resources,
        policy.roles,
        policy.condition === undefined ? null : JSON.stringify(policy.condition),
        updatedBy,
      ],
    );
    return rows[0]?.created ?? false;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM policies WHERE id = $1', [id]);
    return rowCount === 1;
  }
}
