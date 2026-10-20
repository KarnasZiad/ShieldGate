import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { safeEqualStrings } from '../lib/crypto/tokens.js';
import { problems } from '../lib/problem.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Set to false on sign-in routes: they grant no authority from the cookie, so they do not need
     * the session token. The Origin check still applies to them (login CSRF).
     */
    csrfToken?: boolean;
  }
}

/**
 * CSRF defense in depth (threat T1), on top of SameSite=Strict cookies:
 *
 * 1. a state-changing request carrying an Origin header must come from the console;
 * 2. a cookie-authenticated state-changing request must send an Origin header and the
 *    synchronizer token of its session in X-CSRF-Token.
 *
 * API-key requests are not cookie-based and therefore not exposed to CSRF.
 */
export const csrfPlugin = fp(
  (app: FastifyInstance, { allowedOrigins }: { allowedOrigins: string[] }, done) => {
    app.addHook('preValidation', (request, _reply, next) => {
      if (SAFE_METHODS.has(request.method)) {
        next();
        return;
      }

      const origin = request.headers.origin;
      if (origin !== undefined && !allowedOrigins.includes(origin)) {
        next(problems.forbidden('Cross-origin request refused'));
        return;
      }

      if (request.principal?.kind === 'user' && request.routeOptions.config.csrfToken !== false) {
        const token = request.headers['x-csrf-token'];
        const valid =
          origin !== undefined &&
          typeof token === 'string' &&
          safeEqualStrings(token, request.principal.session.csrfToken);
        if (!valid) {
          next(problems.forbidden('Missing or invalid CSRF token'));
          return;
        }
      }
      next();
    });

    done();
  },
);
