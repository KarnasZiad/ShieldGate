import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { clientInfo } from '../../lib/request-context.js';
import { currentSession } from '../../plugins/authenticate.js';
import type { Guards } from '../../plugins/guards.js';
import { PasswordSchema } from '../users/user.schemas.js';
import type { MfaService } from './mfa.service.js';

const SENSITIVE_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

export const mfaRoutes: FastifyPluginCallbackZod<{ mfa: MfaService; guards: Guards }> = (
  app,
  { mfa, guards },
  done,
) => {
  app.addHook('preHandler', guards.requireUser);

  app.post(
    '/totp',
    {
      schema: {
        tags: ['mfa'],
        response: {
          200: z.object({
            secret: z.string(),
            otpauthUri: z.string(),
            expiresInSeconds: z.number(),
          }),
        },
      },
    },
    (request) => mfa.beginTotpSetup(currentSession(request).userId),
  );

  app.post(
    '/totp/activate',
    {
      config: { rateLimit: SENSITIVE_RATE_LIMIT },
      schema: { tags: ['mfa'], body: z.object({ code: z.string().regex(/^[0-9]{6}$/) }) },
    },
    async (request, reply) => {
      await mfa.activateTotp(
        currentSession(request).userId,
        request.body.code,
        clientInfo(request),
      );
      return reply.status(204).send();
    },
  );

  app.post(
    '/totp/disable',
    {
      config: { rateLimit: SENSITIVE_RATE_LIMIT },
      schema: { tags: ['mfa'], body: z.object({ password: PasswordSchema }) },
    },
    async (request, reply) => {
      await mfa.disableTotp(
        currentSession(request).userId,
        request.body.password,
        clientInfo(request),
      );
      return reply.status(204).send();
    },
  );

  done();
};
