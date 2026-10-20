import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
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
import { type HealthProbe, healthRoutes } from './modules/health/health.routes.js';
import { errorsPlugin } from './plugins/errors.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { securityPlugin } from './plugins/security.js';

export interface AppDeps {
  config: AppConfig;
  clock: Clock;
  healthProbes: HealthProbe[];
  /** Shared rate-limit counters; omitted in unit tests. */
  redis?: Redis;
}

export type App = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;

const MAX_REQUEST_ID_LENGTH = 128;

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

  await app.register(errorsPlugin);
  await app.register(securityPlugin, { config });
  await app.register(rateLimitPlugin, deps.redis ? { redis: deps.redis } : {});
  await app.register(healthRoutes, { probes: deps.healthProbes });

  return app;
}
