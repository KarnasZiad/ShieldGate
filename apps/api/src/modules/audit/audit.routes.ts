import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Guards } from '../../plugins/guards.js';
import { AuditAction, type AuditQuery } from './audit-event.js';

const ACTIONS = Object.values(AuditAction) as [
  (typeof AuditAction)[keyof typeof AuditAction],
  ...(typeof AuditAction)[keyof typeof AuditAction][],
];

/**
 * Strings and dates only, unknown parameters refused: a query parameter can never become a
 * MongoDB operator (threat T2).
 */
const SearchSchema = z
  .object({
    action: z.enum(ACTIONS).optional(),
    userId: z.uuid().optional(),
    outcome: z.enum(['success', 'failure']).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    cursor: z
      .string()
      .regex(/^[0-9a-f]{24}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const AuditRecordSchema = z.object({
  id: z.string(),
  '@timestamp': z.string(),
  event: z.object({
    action: z.string(),
    category: z.array(z.string()),
    outcome: z.enum(['success', 'failure']),
    reason: z.string().optional(),
  }),
  user: z
    .object({
      id: z.string().optional(),
      email: z.string().optional(),
      target: z.object({ id: z.string(), email: z.string().optional() }).optional(),
    })
    .optional(),
  source: z.object({ ip: z.string() }).optional(),
  user_agent: z.object({ original: z.string() }).optional(),
  trace: z.object({ id: z.string() }).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

export const auditRoutes: FastifyPluginCallbackZod<{ query: AuditQuery; guards: Guards }> = (
  app,
  { query, guards },
  done,
) => {
  app.get(
    '/audit-events',
    {
      preHandler: guards.requirePermission('audit:read'),
      schema: {
        tags: ['audit'],
        querystring: SearchSchema,
        response: {
          200: z.object({ items: z.array(AuditRecordSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const { from, to, ...filters } = request.query;
      const page = await query.search({
        ...filters,
        ...(from ? { from: new Date(from) } : {}),
        ...(to ? { to: new Date(to) } : {}),
      });
      return {
        items: page.items.map((item) => ({
          ...item,
          '@timestamp': item['@timestamp'].toISOString(),
        })),
        nextCursor: page.nextCursor,
      };
    },
  );

  done();
};
