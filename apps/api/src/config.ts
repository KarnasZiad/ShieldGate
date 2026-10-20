import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

const commaList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

/** "1:<base64 key>,2:<base64 key>": numbered AES-256 keys, so secrets can be re-encrypted later. */
const keyring = z.string().transform((value, context) => {
  const keys: Record<number, Buffer> = {};
  for (const entry of value.split(',')) {
    const [id, encoded] = entry.trim().split(':');
    const key = Buffer.from(encoded ?? '', 'base64');
    if (!id || !/^[0-9]+$/.test(id) || key.length !== 32) {
      context.addIssue({ code: 'custom', message: 'Expected "<id>:<base64 of 32 bytes>" entries' });
      return z.NEVER;
    }
    keys[Number(id)] = key;
  }
  return keys;
});

const base64Secret = z
  .string()
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((buffer) => buffer.length >= 32, 'Must decode to at least 32 bytes');

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Number of reverse proxies in front of the API, used to find the client IP. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  DATABASE_URL: z.string().regex(/^postgres(ql)?:[/][/]/, 'DATABASE_URL must be a PostgreSQL URL'),
  MONGODB_URL: z.string().regex(/^mongodb(\+srv)?:[/][/]/, 'MONGODB_URL must be a MongoDB URL'),
  MONGODB_DATABASE: z.string().default('shieldgate'),
  REDIS_URL: z.string().regex(/^rediss?:[/][/]/, 'REDIS_URL must be a Redis URL'),

  CONSOLE_ORIGINS: commaList.default(['http://localhost:5173']),
  COOKIE_SECURE: booleanFlag.default(true),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(12),

  TOTP_ENCRYPTION_KEYS: keyring,
  TOTP_ENCRYPTION_KEY_ID: z.coerce.number().int().min(1).max(255).default(1),
  API_KEY_PEPPER: base64Secret,

  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3_650).default(400),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  if (!(result.data.TOTP_ENCRYPTION_KEY_ID in result.data.TOTP_ENCRYPTION_KEYS)) {
    throw new Error('TOTP_ENCRYPTION_KEY_ID must reference a key of TOTP_ENCRYPTION_KEYS');
  }
  return result.data;
}
