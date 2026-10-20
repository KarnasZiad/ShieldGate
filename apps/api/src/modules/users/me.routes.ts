import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problems } from '../../lib/problem.js';
import { clientInfo } from '../../lib/request-context.js';
import { currentSession } from '../../plugins/authenticate.js';
import type { Guards } from '../../plugins/guards.js';
import { AuditAction } from '../audit/audit-event.js';
import type { AuditLogger } from '../audit/audit-logger.js';
import type { SessionStore } from '../sessions/session.js';
import {
  SessionHandleParamsSchema,
  SessionViewSchema,
  toSessionView,
} from '../sessions/session.schemas.js';
import { toPublicUser, type UserRepository } from './user.js';
import { PublicUserSchema } from './user.schemas.js';

export interface MeRoutesOptions {
  users: UserRepository;
  sessions: SessionStore;
  audit: AuditLogger;
  guards: Guards;
}

/** Self-service: every route acts on the signed-in user only (no IDOR, threat E1). */
export const meRoutes: FastifyPluginCallbackZod<MeRoutesOptions> = (app, options, done) => {
  const { users, sessions, audit, guards } = options;

  app.addHook('preHandler', guards.requireUser);

  app.get(
    '/',
    { schema: { tags: ['me'], response: { 200: PublicUserSchema } } },
    async (request) => {
      const user = await users.findById(currentSession(request).userId);
      if (!user) throw problems.unauthorized('Account not found');
      return toPublicUser(user);
    },
  );

  app.get(
    '/sessions',
    { schema: { tags: ['me'], response: { 200: z.array(SessionViewSchema) } } },
    async (request) => {
      const session = currentSession(request);
      const all = await sessions.list(session.userId);
      return all.map((item) => toSessionView(item, session.handle));
    },
  );

  app.delete(
    '/sessions/:id',
    { schema: { tags: ['me'], params: SessionHandleParamsSchema } },
    async (request, reply) => {
      const session = currentSession(request);
      const target = await sessions.get(request.params.id);
      // Another user's session is reported as missing, not as forbidden: nothing to enumerate.
      if (target?.userId !== session.userId) throw problems.notFound('Session not found');
      await sessions.revoke(target.handle);
      audit.record({
        action: AuditAction.SessionRevoked,
        outcome: 'success',
        user: { id: session.userId, email: session.email },
        labels: { scope: 'self' },
        ...clientInfo(request),
      });
      return reply.status(204).send();
    },
  );

  done();
};
