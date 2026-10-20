import type { FastifyRequest } from 'fastify';
import { problems } from '../lib/problem.js';
import type { Policy } from '../modules/authorization/policy.js';
import type { PolicyEngine } from '../modules/authorization/policy-engine.js';

export type Guard = (request: FastifyRequest) => Promise<void>;

/** The permissions snapshotted in a session, expressed as a policy for the engine. */
function sessionPolicies(permissions: readonly string[]): Policy[] {
  if (permissions.length === 0) return [];
  return [
    {
      id: 'session-permissions',
      description: 'Permissions granted by the roles of the session',
      effect: 'allow',
      actions: [...permissions],
      resources: ['*'],
      roles: [],
    },
  ];
}

/** Route guards. The console is protected by the same policy engine as client applications. */
export function createGuards(engine: PolicyEngine) {
  const requireUser: Guard = (request) => {
    if (request.principal?.kind !== 'user') {
      return Promise.reject(problems.unauthorized('Authentication required'));
    }
    return Promise.resolve();
  };

  const requirePermission =
    (action: string): Guard =>
    (request) => {
      const principal = request.principal;
      if (principal?.kind !== 'user') {
        return Promise.reject(problems.unauthorized('Authentication required'));
      }
      const decision = engine.evaluate(
        {
          subject: { id: principal.session.userId, roles: principal.session.roles, attributes: {} },
          action,
          resource: { type: action.split(':')[0] ?? 'unknown', id: 'any', attributes: {} },
          context: { ip: request.ip },
        },
        sessionPolicies(principal.session.permissions),
      );
      if (decision.decision !== 'allow') {
        return Promise.reject(problems.forbidden(`Missing permission ${action}`));
      }
      return Promise.resolve();
    };

  const requireScope =
    (scope: string): Guard =>
    (request) => {
      const principal = request.principal;
      if (principal?.kind !== 'api-key') {
        return Promise.reject(problems.unauthorized('API key required'));
      }
      if (!principal.scopes.includes(scope)) {
        return Promise.reject(problems.forbidden(`Missing scope ${scope}`));
      }
      return Promise.resolve();
    };

  return { requireUser, requirePermission, requireScope };
}

export type Guards = ReturnType<typeof createGuards>;
