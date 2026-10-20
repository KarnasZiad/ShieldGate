import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/** OpenAPI 3 document generated from the Zod schemas of every route, served outside production. */
export const openApiPlugin = fp(async (app: FastifyInstance) => {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ShieldGate API',
        description:
          'Identity platform: sessions, MFA, API keys, policy decision point, audit trail',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: '__Host-sg_session' },
          apiKey: { type: 'http', scheme: 'bearer', description: 'sg_live_... API key' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  // staticCSP gives the documentation pages their own policy instead of the API's default-src 'none'.
  await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
});
