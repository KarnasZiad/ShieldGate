import type { FastifyReply } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { clientInfo } from '../../lib/request-context.js';
import { currentSession } from '../../plugins/authenticate.js';
import type { Guards } from '../../plugins/guards.js';
import type { Session, SessionStore } from '../sessions/session.js';
import { EmailSchema, PasswordSchema } from '../users/user.schemas.js';
import type { AuthService, LoginResult } from './auth.service.js';

export interface SessionCookie {
  name: string;
  secure: boolean;
  maxAgeSeconds: number;
}

export interface AuthRoutesOptions {
  auth: AuthService;
  sessions: SessionStore;
  guards: Guards;
  cookie: SessionCookie;
}

const SessionUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

const AuthenticatedSchema = z.object({
  status: z.literal('authenticated'),
  user: SessionUserSchema,
  csrfToken: z.string(),
  mfa: z.boolean(),
  expiresAt: z.string(),
});

const LoginResponseSchema = z.discriminatedUnion('status', [
  AuthenticatedSchema,
  z.object({
    status: z.literal('mfa_required'),
    challengeId: z.string(),
    expiresIn: z.number(),
  }),
]);

/** Strict limits on credential endpoints, before any password hashing happens (S1, D1). */
const CREDENTIAL_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

function authenticated(session: Session): z.infer<typeof AuthenticatedSchema> {
  return {
    status: 'authenticated',
    user: {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      roles: session.roles,
      permissions: session.permissions,
    },
    csrfToken: session.csrfToken,
    mfa: session.mfa,
    expiresAt: new Date(session.absoluteExpiresAt).toISOString(),
  };
}

export const authRoutes: FastifyPluginCallbackZod<AuthRoutesOptions> = (app, options, done) => {
  const { auth, sessions, guards, cookie } = options;

  async function respond(
    result: LoginResult,
    previousSessionId: string | undefined,
    reply: FastifyReply,
  ) {
    if (result.kind === 'mfa_required') {
      return {
        status: 'mfa_required' as const,
        challengeId: result.challengeId,
        expiresIn: result.expiresInSeconds,
      };
    }
    // Anti-fixation: a sign-in always replaces any session the browser already had.
    if (previousSessionId) {
      const previous = await sessions.touch(previousSessionId);
      if (previous) await sessions.revoke(previous.handle);
    }
    void reply.setCookie(cookie.name, result.sessionId, {
      httpOnly: true,
      secure: cookie.secure,
      sameSite: 'strict',
      path: '/',
      maxAge: cookie.maxAgeSeconds,
    });
    return authenticated(result.session);
  }

  app.post(
    '/login',
    {
      config: { rateLimit: CREDENTIAL_RATE_LIMIT, csrfToken: false },
      schema: {
        tags: ['auth'],
        body: z.object({ email: EmailSchema, password: PasswordSchema }),
        response: { 200: LoginResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await auth.login(
        request.body.email,
        request.body.password,
        clientInfo(request),
      );
      return respond(result, request.cookies[cookie.name], reply);
    },
  );

  app.post(
    '/mfa',
    {
      config: { rateLimit: CREDENTIAL_RATE_LIMIT, csrfToken: false },
      schema: {
        tags: ['auth'],
        body: z.object({ challengeId: z.string().max(64), code: z.string().regex(/^[0-9]{6}$/) }),
        response: { 200: LoginResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await auth.completeMfa(
        request.body.challengeId,
        request.body.code,
        clientInfo(request),
      );
      return respond(result, request.cookies[cookie.name], reply);
    },
  );

  app.post(
    '/logout',
    { preHandler: guards.requireUser, schema: { tags: ['auth'] } },
    async (request, reply) => {
      await auth.logout(currentSession(request), clientInfo(request));
      return reply.clearCookie(cookie.name, { path: '/' }).status(204).send();
    },
  );

  app.get(
    '/session',
    {
      preHandler: guards.requireUser,
      schema: { tags: ['auth'], response: { 200: AuthenticatedSchema } },
    },
    (request) => authenticated(currentSession(request)),
  );

  done();
};
