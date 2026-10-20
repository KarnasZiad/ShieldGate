import type { FastifyRequest } from 'fastify';
import type { ClientInfo } from '../modules/auth/auth.service.js';
import type { Actor } from '../modules/users/users.service.js';
import { currentSession } from '../plugins/authenticate.js';

export function clientInfo(request: FastifyRequest): ClientInfo {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? '',
    requestId: request.id,
  };
}

/** The signed-in user performing an administrative action, for the audit trail. */
export function actorOf(request: FastifyRequest): Actor {
  const session = currentSession(request);
  return { id: session.userId, email: session.email, ...clientInfo(request) };
}
