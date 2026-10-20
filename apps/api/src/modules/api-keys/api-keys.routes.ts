import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../lib/request-context.js';
import type { Guards } from '../../plugins/guards.js';
import { IdParamsSchema } from '../users/user.schemas.js';
import { API_KEY_SCOPES, type ApiKey } from './api-key.js';
import type { ApiKeysService } from './api-keys.service.js';

const ApiKeyViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  ownerId: z.uuid(),
  scopes: z.array(z.enum(API_KEY_SCOPES)),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

/** The HMAC never leaves the API; the prefix lets an administrator recognize a key. */
function toView(key: ApiKey): z.infer<typeof ApiKeyViewSchema> {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    ownerId: key.ownerId,
    scopes: key.scopes,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}

export const apiKeysRoutes: FastifyPluginCallbackZod<{
  service: ApiKeysService;
  guards: Guards;
}> = (app, { service, guards }, done) => {
  app.get(
    '/',
    {
      preHandler: guards.requirePermission('api-keys:read'),
      schema: { tags: ['api-keys'], response: { 200: z.array(ApiKeyViewSchema) } },
    },
    async () => (await service.list()).map(toView),
  );

  app.post(
    '/',
    {
      preHandler: guards.requirePermission('api-keys:write'),
      schema: {
        tags: ['api-keys'],
        body: z.object({
          name: z.string().trim().min(1).max(100),
          scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
          expiresInDays: z.int().min(1).max(365).optional(),
        }),
        response: { 201: ApiKeyViewSchema.extend({ key: z.string() }) },
      },
    },
    async (request, reply) => {
      const { key, apiKey } = await service.create(request.body, actorOf(request));
      return reply.status(201).send({ ...toView(apiKey), key });
    },
  );

  app.delete(
    '/:id',
    {
      preHandler: guards.requirePermission('api-keys:write'),
      schema: { tags: ['api-keys'], params: IdParamsSchema },
    },
    async (request, reply) => {
      await service.revoke(request.params.id, actorOf(request));
      return reply.status(204).send();
    },
  );

  done();
};
