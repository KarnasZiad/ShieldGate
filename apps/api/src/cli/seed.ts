/**
 * Creates the first administrator from SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (idempotent).
 * Usage: pnpm --filter @shieldgate/api db:seed
 */
import { z } from 'zod';
import { createPool } from '../infrastructure/postgres.js';
import { checkPassword } from '../modules/users/password-policy.js';
import { PasswordHasher } from '../modules/users/password-hasher.js';
import { PostgresUserRepository } from '../modules/users/user-repository.postgres.js';

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: z.string().min(1),
  })
  .parse(process.env);

const problems = checkPassword(env.SEED_ADMIN_PASSWORD, { email: env.SEED_ADMIN_EMAIL });
if (problems.length > 0) {
  console.error(`SEED_ADMIN_PASSWORD does not meet the password policy: ${problems.join(', ')}`);
  process.exit(1);
}

const pool = createPool(env.DATABASE_URL);
try {
  const users = new PostgresUserRepository(pool);
  if (await users.findByEmail(env.SEED_ADMIN_EMAIL)) {
    console.log(`${env.SEED_ADMIN_EMAIL} already exists, nothing to do`);
  } else {
    await users.create({
      email: env.SEED_ADMIN_EMAIL.toLowerCase(),
      displayName: 'Administrator',
      passwordHash: await new PasswordHasher().hash(env.SEED_ADMIN_PASSWORD),
      roles: ['admin'],
    });
    console.log(`Created administrator ${env.SEED_ADMIN_EMAIL}`);
  }
} finally {
  await pool.end();
}
