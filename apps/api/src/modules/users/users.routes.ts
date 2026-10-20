import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf, clientInfo } from '../../lib/request-context.js';
import type { Guards } from '../../plugins/guards.js';
import { AuditAction } from '../audit/audit-event.js';
import type { AuditLogger } from '../audit/audit-logger.js';
import type { LoginThrottle } from '../auth/login-throttle.js';
import type { SessionStore } from '../sessions/session.js';
import { SessionViewSchema, toSessionView } from '../sessions/session.schemas.js';
import { type RoleRepository, toPublicUser } from './user.js';
import {
  CreateUserSchema,
  IdParamsSchema,
  PublicUserSchema,
  UpdateUserSchema,
  UserListQuerySchema,
} from './user.schemas.js';
import type { UsersService } from './users.service.js';

export interface UsersRoutesOptions {
  service: UsersService;
  roles: RoleRepository;
  sessions: SessionStore;
  throttle: LoginThrottle;
  audit: AuditLogger;
  guards: Guards;
}

export const usersRoutes: FastifyPluginCallbackZod<UsersRoutesOptions> = (app, options, done) => {
  const { service, roles, sessions, throttle, audit, guards } = options;

  app.get(
    '/users',
    {
      preHandler: guards.requirePermission('users:read'),
      schema: {
        tags: ['users'],
        querystring: UserListQuerySchema,
        response: {
          200: z.object({ items: z.array(PublicUserSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const page = await service.list(request.query);
      return { items: page.items.map(toPublicUser), nextCursor: page.nextCursor };
    },
  );

  app.post(
    '/users',
    {
      preHandler: guards.requirePermission('users:write'),
      schema: { tags: ['users'], body: CreateUserSchema, response: { 201: PublicUserSchema } },
    },
    async (request, reply) => {
      const user = await service.create(request.body, actorOf(request));
      return reply.status(201).send(toPublicUser(user));
    },
  );

  app.get(
    '/users/:id',
    {
      preHandler: guards.requirePermission('users:read'),
      schema: { tags: ['users'], params: IdParamsSchema, response: { 200: PublicUserSchema } },
    },
    async (request) => toPublicUser(await service.get(request.params.id)),
  );

  app.patch(
    '/users/:id',
    {
      preHandler: guards.requirePermission('users:write'),
      schema: {
        tags: ['users'],
        params: IdParamsSchema,
        body: UpdateUserSchema,
        response: { 200: PublicUserSchema },
      },
    },
    async (request) =>
      toPublicUser(await service.update(request.params.id, request.body, actorOf(request))),
  );

  app.post(
    '/users/:id/unlock',
    {
      preHandler: guards.requirePermission('users:write'),
      schema: { tags: ['users'], params: IdParamsSchema },
    },
    async (request, reply) => {
      const user = await service.get(request.params.id);
      await throttle.unlock(user.email);
      const actor = actorOf(request);
      audit.record({
        action: AuditAction.AccountUnlocked,
        outcome: 'success',
        user: { id: actor.id, email: actor.email, target: { id: user.id, email: user.email } },
        ...clientInfo(request),
      });
      return reply.status(204).send();
    },
  );

  app.get(
    '/users/:id/sessions',
    {
      preHandler: guards.requirePermission('sessions:read'),
      schema: {
        tags: ['users'],
        params: IdParamsSchema,
        response: { 200: z.array(SessionViewSchema) },
      },
    },
    async (request) => {
      const user = await service.get(request.params.id);
      return (await sessions.list(user.id)).map((session) => toSessionView(session));
    },
  );

  app.delete(
    '/users/:id/sessions',
    {
      preHandler: guards.requirePermission('sessions:revoke'),
      schema: {
        tags: ['users'],
        params: IdParamsSchema,
        response: { 200: z.object({ revoked: z.number() }) },
      },
    },
    async (request) => {
      const user = await service.get(request.params.id);
      const revoked = await sessions.revokeAllForUser(user.id);
      const actor = actorOf(request);
      audit.record({
        action: AuditAction.SessionRevoked,
        outcome: 'success',
        user: { id: actor.id, email: actor.email, target: { id: user.id, email: user.email } },
        labels: { scope: 'all', count: String(revoked) },
        ...clientInfo(request),
      });
      return { revoked };
    },
  );

  app.get(
    '/roles',
    {
      preHandler: guards.requirePermission('users:read'),
      schema: {
        tags: ['users'],
        response: {
          200: z.array(
            z.object({
              name: z.string(),
              description: z.string(),
              permissions: z.array(z.string()),
            }),
          ),
        },
      },
    },
    () => roles.list(),
  );

  done();
};
