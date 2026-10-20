import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from '../testing/test-app.js';

interface OpenApiDocument {
  info: { title: string };
  paths: Record<
    string,
    Record<string, { requestBody?: { content: Record<string, { schema: unknown }> } }>
  >;
}

describe('OpenAPI document', () => {
  let context: TestContext | undefined;

  afterEach(async () => {
    await context?.app.close();
  });

  it('documents every route from the Zod schemas', async () => {
    context = await createTestApp();

    const response = await context.app.inject({ method: 'GET', url: '/docs/json' });
    const document = response.json<OpenApiDocument>();

    expect(response.statusCode).toBe(200);
    expect(document.info.title).toBe('ShieldGate API');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/v1/auth/login',
        '/v1/auth/mfa',
        '/v1/me/sessions/{id}',
        '/v1/users/{id}',
        '/v1/api-keys/',
        '/v1/authorize',
        '/v1/policies/{id}',
        '/v1/audit-events',
      ]),
    );
    expect(
      document.paths['/v1/auth/login']?.post?.requestBody?.content['application/json']?.schema,
    ).toMatchObject({
      required: ['email', 'password'],
    });
  });

  it('is not exposed in production', async () => {
    context = await createTestApp({ env: { NODE_ENV: 'production' } });

    expect((await context.app.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(404);
  });
});
