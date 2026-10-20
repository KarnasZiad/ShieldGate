import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { problems } from '../lib/problem.js';
import type { Session, SessionStore } from '../modules/sessions/session.js';

export interface UserPrincipal {
  kind: 'user';
  session: Session;
}

export interface ApiKeyPrincipal {
  kind: 'api-key';
  keyId: string;
  name: string;
  ownerId: string;
  scopes: string[];
}

export type Principal = UserPrincipal | ApiKeyPrincipal;

/** Resolves an `Authorization: Bearer` API key (provided by the api-keys module). */
export type ApiKeyAuthenticator = (
  token: string,
  request: FastifyRequest,
) => Promise<ApiKeyPrincipal | null>;

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

/**
 * `__Host-` cookies must be Secure, have Path=/ and no Domain: the browser refuses any attempt to
 * set or shadow them from a subdomain. Plain HTTP local development uses an unprefixed name.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-sg_session' : 'sg_session';
}

export interface AuthenticateOptions {
  sessions: SessionStore;
  cookieName: string;
  apiKeys?: ApiKeyAuthenticator;
}

export const authenticatePlugin = fp((app: FastifyInstance, options: AuthenticateOptions, done) => {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request) => {
    const sessionId = request.cookies[options.cookieName];
    if (sessionId) {
      const session = await options.sessions.touch(sessionId);
      if (session) {
        request.principal = { kind: 'user', session };
        return;
      }
    }
    const authorization = request.headers.authorization;
    if (options.apiKeys && authorization?.startsWith('Bearer ')) {
      request.principal = await options.apiKeys(
        authorization.slice('Bearer '.length).trim(),
        request,
      );
    }
  });

  done();
});

export function currentSession(request: FastifyRequest): Session {
  if (request.principal?.kind !== 'user') {
    throw problems.unauthorized('Authentication required');
  }
  return request.principal.session;
}
