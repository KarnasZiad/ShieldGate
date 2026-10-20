import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * HTTP hardening (ASVS V14.4). The API only serves JSON, so its CSP forbids everything; the
 * console sets its own policy. HSTS is also set by the TLS-terminating proxy in production.
 */
export const securityPlugin = fp(
  async (app: FastifyInstance, { config }: { config: Pick<AppConfig, 'CONSOLE_ORIGINS'> }) => {
    await app.register(helmet, {
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      strictTransportSecurity: { maxAge: ONE_YEAR_SECONDS, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    });

    await app.register(cors, {
      origin: config.CONSOLE_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
      maxAge: 600,
    });
  },
);
