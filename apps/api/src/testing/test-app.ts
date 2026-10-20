import { type App, buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { FixedClock } from '../lib/clock.js';
import { AuditLogger } from '../modules/audit/audit-logger.js';
import type { LoginThrottleRules } from '../modules/auth/login-throttle.js';
import type { HealthProbe } from '../modules/health/health.routes.js';
import { PasswordHasher } from '../modules/users/password-hasher.js';
import { testConfig } from './config.js';
import { InMemoryAuditStore } from './in-memory-audit-store.js';
import { InMemoryLoginThrottleStore, InMemoryMfaChallengeStore } from './in-memory-auth-stores.js';
import { InMemorySessionStore } from './in-memory-sessions.js';
import { InMemoryRoleRepository, InMemoryUserRepository } from './in-memory-users.js';

export const ORIGIN = 'https://console.shieldgate.test';
export const STRONG_PASSWORD = 'le thé à la menthe de grand-mère';

export interface TestContext {
  app: App;
  clock: FixedClock;
  config: AppConfig;
  users: InMemoryUserRepository;
  sessions: InMemorySessionStore;
  auditStore: InMemoryAuditStore;
  audit: AuditLogger;
  hasher: PasswordHasher;
}

export interface TestAppOptions {
  probes?: HealthProbe[];
  env?: NodeJS.ProcessEnv;
  throttleRules?: Partial<LoginThrottleRules>;
}

/** The whole API wired with in-memory adapters and a controllable clock. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const config = testConfig(options.env);
  const clock = new FixedClock(Date.parse('2026-10-20T09:00:00Z'));
  const roles = new InMemoryRoleRepository();
  const users = new InMemoryUserRepository(roles);
  const sessions = new InMemorySessionStore(clock, {
    idleMs: config.SESSION_IDLE_MINUTES * 60_000,
    absoluteMs: config.SESSION_ABSOLUTE_HOURS * 3_600_000,
  });
  const auditStore = new InMemoryAuditStore();
  const audit = new AuditLogger(auditStore, clock);
  const hasher = new PasswordHasher();

  const app = await buildApp({
    config,
    clock,
    healthProbes: options.probes ?? [],
    users,
    roles,
    sessions,
    loginThrottle: new InMemoryLoginThrottleStore(clock),
    mfaChallenges: new InMemoryMfaChallengeStore(clock),
    audit,
    hasher,
    ...(options.throttleRules ? { throttleRules: options.throttleRules } : {}),
  });
  return { app, clock, config, users, sessions, auditStore, audit, hasher };
}

export async function createUser(
  context: TestContext,
  {
    email,
    roles = ['member'],
    password = STRONG_PASSWORD,
  }: { email: string; roles?: string[]; password?: string },
) {
  return context.users.create({
    email,
    displayName: email.split('@')[0] ?? email,
    passwordHash: await context.hasher.hash(password),
    roles,
  });
}

export interface SignedIn {
  cookie: string;
  csrfToken: string;
  /** Headers of a legitimate console request: cookie, Origin and CSRF token. */
  headers: Record<string, string>;
}

export async function signIn(
  context: TestContext,
  email: string,
  password = STRONG_PASSWORD,
  ip = '203.0.113.10',
): Promise<SignedIn> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { origin: ORIGIN },
    remoteAddress: ip,
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Sign-in failed with ${response.statusCode}: ${response.body}`);
  }
  const cookieHeader = [response.headers['set-cookie']].flat()[0] ?? '';
  const cookie = cookieHeader.split(';')[0] ?? '';
  const { csrfToken } = response.json<{ csrfToken: string }>();
  return { cookie, csrfToken, headers: { cookie, origin: ORIGIN, 'x-csrf-token': csrfToken } };
}
