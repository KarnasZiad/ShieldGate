import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { HttpProblem } from '../lib/problem.js';

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
};

function sendProblem(
  reply: FastifyReply,
  status: number,
  title: string,
  detail?: string,
  extensions: Record<string, unknown> = {},
) {
  return reply
    .status(status)
    .type('application/problem+json')
    .send({ type: 'about:blank', title, status, ...(detail ? { detail } : {}), ...extensions });
}

/** Every error becomes an RFC 9457 problem; unexpected ones are logged and answered generically. */
export const errorsPlugin = fp((app: FastifyInstance) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpProblem) {
      return sendProblem(reply, error.status, error.title, error.detail, error.extensions);
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors = error.validation.map((issue) => ({
        path: issue.instancePath.replace(/^[/]/, '').replaceAll('/', '.'),
        message: issue.message,
      }));
      return sendProblem(reply, 400, 'Bad Request', 'Validation failed', { errors });
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return sendProblem(reply, status, STATUS_TITLES[status] ?? 'Client Error', error.message);
    }
    request.log.error({ err: error }, 'Unhandled error');
    return sendProblem(reply, 500, 'Internal Server Error');
  });

  app.setNotFoundHandler((request, reply) =>
    sendProblem(reply, 404, 'Not Found', `No route for ${request.method} ${request.url}`),
  );
});
