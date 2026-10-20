import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loggerOptions } from './app.js';
import { systemClock } from './lib/clock.js';
import type { HealthProbe } from './modules/health/health.routes.js';
import { testConfig } from './testing/config.js';

const up: HealthProbe = { name: 'postgres', check: () => Promise.resolve() };
const down: HealthProbe = { name: 'redis', check: () => Promise.reject(new Error('ECONNREFUSED')) };

describe('application', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  async function start(probes: HealthProbe[]) {
    app = await buildApp({ config: testConfig(), clock: systemClock, healthProbes: probes });
    return app;
  }

  it('answers liveness without checking dependencies', async () => {
    const response = await (await start([down])).inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness per dependency and returns 503 when one is down', async () => {
    const response = await (
      await start([up, down])
    ).inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      checks: { postgres: 'up', redis: 'down' },
    });
  });

  it('sends hardened security headers', async () => {
    const response = await (await start([up])).inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('only allows the console origin with credentials', async () => {
    const server = await start([up]);

    const allowed = await server.inject({
      method: 'OPTIONS',
      url: '/health/live',
      headers: {
        origin: 'https://console.shieldgate.test',
        'access-control-request-method': 'GET',
      },
    });
    const refused = await server.inject({
      method: 'OPTIONS',
      url: '/health/live',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });

    expect(allowed.headers['access-control-allow-origin']).toBe('https://console.shieldgate.test');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers unknown routes with an RFC 9457 problem', async () => {
    const response = await (await start([up])).inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No route for GET /nope',
    });
  });

  it('propagates a reasonable request id and replaces suspicious ones', async () => {
    const server = await start([up]);

    const kept = await server.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'req-42' },
    });
    const replaced = await server.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'x'.repeat(500) },
    });

    expect(kept.headers['x-request-id']).toBe('req-42');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never logs credentials and pretty-prints only in development', () => {
    expect(loggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'production' })).toMatchObject({
      redact: {
        paths: expect.arrayContaining([
          'req.headers.authorization',
          'req.headers.cookie',
        ]) as unknown,
      },
    });
    expect(loggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'development' })).toHaveProperty(
      'transport',
    );
  });
});
