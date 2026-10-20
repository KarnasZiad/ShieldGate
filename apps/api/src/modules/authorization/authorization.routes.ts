import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problems } from '../../lib/problem.js';
import { actorOf, clientInfo } from '../../lib/request-context.js';
import type { Guards } from '../../plugins/guards.js';
import { AuditAction } from '../audit/audit-event.js';
import type { AuditLogger } from '../audit/audit-logger.js';
import { AuthorizationRequestSchema, PolicySchema } from './policy.js';
import type { PolicyEngine } from './policy-engine.js';
import type { CachedPolicySource, PolicyRepository } from './policy-repository.js';

export interface AuthorizationRoutesOptions {
  engine: PolicyEngine;
  repository: PolicyRepository;
  source: CachedPolicySource;
  audit: AuditLogger;
  guards: Guards;
}

const PolicyIdParams = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/) });
const PolicyBodySchema = PolicySchema.omit({ id: true });

const DecisionSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  policyId: z.string().nullable(),
  reason: z.enum(['deny_policy', 'allow_policy', 'no_matching_policy']),
});

/** Client applications call the PDP heavily: they are limited per API key, not per IP. */
const PDP_RATE_LIMIT = {
  max: 6_000,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (request: FastifyRequest) =>
    request.principal?.kind === 'api-key' ? `api-key:${request.principal.keyId}` : request.ip,
};

export const authorizationRoutes: FastifyPluginCallbackZod<AuthorizationRoutesOptions> = (
  app,
  { engine, repository, source, audit, guards },
  done,
) => {
  app.post(
    '/authorize',
    {
      config: { rateLimit: PDP_RATE_LIMIT },
      // A client application with the "authorize" scope, or a console user testing a request.
      preHandler: (request) =>
        request.principal?.kind === 'api-key'
          ? guards.requireScope('authorize')(request)
          : guards.requirePermission('authz:evaluate')(request),
      schema: {
        tags: ['authorization'],
        body: AuthorizationRequestSchema,
        response: { 200: DecisionSchema },
      },
    },
    async (request) => {
      const decision = engine.evaluate(request.body, await source.all());
      const principal = request.principal;
      audit.record({
        action: AuditAction.AuthorizationDecision,
        outcome: decision.decision === 'allow' ? 'success' : 'failure',
        reason: decision.reason,
        user: { id: request.body.subject.id },
        labels: {
          decision: decision.decision,
          policy: decision.policyId ?? 'none',
          action: request.body.action,
          resource: `${request.body.resource.type}:${request.body.resource.id}`,
          client: principal?.kind === 'api-key' ? principal.name : 'console',
        },
        ...clientInfo(request),
      });
      return decision;
    },
  );

  app.get(
    '/policies',
    {
      preHandler: guards.requirePermission('policies:read'),
      schema: { tags: ['authorization'], response: { 200: z.array(PolicySchema) } },
    },
    () => repository.list(),
  );

  app.put(
    '/policies/:id',
    {
      preHandler: guards.requirePermission('policies:write'),
      schema: {
        tags: ['authorization'],
        params: PolicyIdParams,
        body: PolicyBodySchema,
        response: { 200: PolicySchema, 201: PolicySchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const policy = { ...request.body, id: request.params.id };
      const created = await repository.upsert(policy, actor.id);
      source.invalidate();
      // Every policy change is audited with its author (threat T3).
      audit.record({
        action: AuditAction.PolicyChanged,
        outcome: 'success',
        user: { id: actor.id, email: actor.email },
        labels: {
          policy: policy.id,
          change: created ? 'created' : 'updated',
          effect: policy.effect,
        },
        ...clientInfo(request),
      });
      return reply.status(created ? 201 : 200).send(policy);
    },
  );

  app.delete(
    '/policies/:id',
    {
      preHandler: guards.requirePermission('policies:write'),
      schema: { tags: ['authorization'], params: PolicyIdParams },
    },
    async (request, reply) => {
      if (!(await repository.delete(request.params.id)))
        throw problems.notFound('Policy not found');
      source.invalidate();
      const actor = actorOf(request);
      audit.record({
        action: AuditAction.PolicyChanged,
        outcome: 'success',
        user: { id: actor.id, email: actor.email },
        labels: { policy: request.params.id, change: 'deleted' },
        ...clientInfo(request),
      });
      return reply.status(204).send();
    },
  );

  done();
};
