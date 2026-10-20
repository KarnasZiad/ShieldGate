import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import cookie from '@fastify/cookie';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type { AppConfig } from './config.js';
import type { Clock } from './lib/clock.js';
import { SecretBox } from './lib/crypto/secret-box.js';
import type { EphemeralStore } from './lib/ephemeral-store.js';
import type { AuditLogger } from './modules/audit/audit-logger.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import {
  DEFAULT_THROTTLE_RULES,
  LoginThrottle,
  type LoginThrottleRules,
  type LoginThrottleStore,
} from './modules/auth/login-throttle.js';
import type { MfaChallengeStore } from './modules/auth/mfa-challenge.js';
import { PolicyEngine } from './modules/authorization/policy-engine.js';
import { type HealthProbe, healthRoutes } from './modules/health/health.routes.js';
import { mfaRoutes } from './modules/mfa/mfa.routes.js';
import { MfaService } from './modules/mfa/mfa.service.js';
import type { SessionStore } from './modules/sessions/session.js';
import { meRoutes } from './modules/users/me.routes.js';
import { PasswordHasher } from './modules/users/password-hasher.js';
import type { RoleRepository, UserRepository } from './modules/users/user.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { UsersService } from './modules/users/users.service.js';
import { authenticatePlugin, sessionCookieName } from './plugins/authenticate.js';
import { csrfPlugin } from './plugins/csrf.js';
import { errorsPlugin } from './plugins/errors.js';
import { createGuards } from './plugins/guards.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { securityPlugin } from './plugins/security.js';

/** Everything the API needs from the outside world: real adapters in production, fakes in tests. */
export interface AppDeps {
  config: AppConfig;
  clock: Clock;
  healthProbes: HealthProbe[];
  /** Shared rate-limit counters; omitted in unit tests. */
  redis?: Redis;
  users: UserRepository;
  roles: RoleRepository;
  sessions: SessionStore;
  loginThrottle: LoginThrottleStore;
  mfaChallenges: MfaChallengeStore;
  audit: AuditLogger;
  hasher?: PasswordHasher;
  throttleRules?: Partial<LoginThrottleRules>;
  /** Pending TOTP enrollments (sealed secrets), 10 minutes. */
  pendingMfaSetups: EphemeralStore;
}

export type App = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;

const MAX_REQUEST_ID_LENGTH = 128;
const HOUR_SECONDS = 3_600;

export function loggerOptions(
  config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>,
): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    // Credentials never reach the logs (threat I2).
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  };
}

/** Composition root: builds the services from their dependencies and registers the routes. */
export async function buildApp(deps: AppDeps): Promise<App> {
  const { config } = deps;
  const app = Fastify({
    logger: loggerOptions(config),
    // Trust only the configured number of proxy hops when reading X-Forwarded-For.
    trustProxy: (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
    bodyLimit: 64 * 1024,
    // No requestIdHeader: Fastify would trust the header as-is. genReqId validates it instead.
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      return typeof header === 'string' && header.length <= MAX_REQUEST_ID_LENGTH
        ? header
        : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Echo the request id so a user can quote it and support can find the matching logs.
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });

  const hasher = deps.hasher ?? new PasswordHasher();
  const secretBox = new SecretBox(config.TOTP_ENCRYPTION_KEYS, config.TOTP_ENCRYPTION_KEY_ID);
  const throttle = new LoginThrottle(deps.loginThrottle, {
    ...DEFAULT_THROTTLE_RULES,
    ...deps.throttleRules,
  });
  const guards = createGuards(new PolicyEngine(deps.clock));
  const auth = new AuthService({
    users: deps.users,
    roles: deps.roles,
    sessions: deps.sessions,
    throttle,
    challenges: deps.mfaChallenges,
    hasher,
    secretBox,
    audit: deps.audit,
    clock: deps.clock,
  });
  const usersService = new UsersService(deps.users, hasher, deps.sessions, deps.audit);
  const mfa = new MfaService({
    users: deps.users,
    pendingSetups: deps.pendingMfaSetups,
    secretBox,
    hasher,
    audit: deps.audit,
    clock: deps.clock,
  });
  const cookieName = sessionCookieName(config.COOKIE_SECURE);

  deps.audit.start();
  app.addHook('onClose', () => deps.audit.stop());

  await app.register(errorsPlugin);
  await app.register(securityPlugin, { config });
  await app.register(rateLimitPlugin, deps.redis ? { redis: deps.redis } : {});
  await app.register(cookie);
  await app.register(authenticatePlugin, { sessions: deps.sessions, cookieName });
  await app.register(csrfPlugin, { allowedOrigins: config.CONSOLE_ORIGINS });

  await app.register(healthRoutes, { probes: deps.healthProbes });
  await app.register(authRoutes, {
    prefix: '/v1/auth',
    auth,
    sessions: deps.sessions,
    guards,
    cookie: {
      name: cookieName,
      secure: config.COOKIE_SECURE,
      maxAgeSeconds: config.SESSION_ABSOLUTE_HOURS * HOUR_SECONDS,
    },
  });
  await app.register(meRoutes, {
    prefix: '/v1/me',
    users: deps.users,
    sessions: deps.sessions,
    audit: deps.audit,
    guards,
  });
  await app.register(mfaRoutes, { prefix: '/v1/me/mfa', mfa, guards });
  await app.register(usersRoutes, {
    prefix: '/v1',
    service: usersService,
    roles: deps.roles,
    sessions: deps.sessions,
    throttle,
    audit: deps.audit,
    guards,
  });

  return app;
}
