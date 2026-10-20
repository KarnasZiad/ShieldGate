import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export interface HealthProbe {
  name: string;
  check: () => Promise<unknown>;
}

const PROBE_TIMEOUT_MS = 2_000;

async function run(probe: HealthProbe): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe.check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'));
        }, PROBE_TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

const ReadinessSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.record(z.string(), z.enum(['up', 'down'])),
});

export const healthRoutes: FastifyPluginCallbackZod<{ probes: HealthProbe[] }> = (
  app,
  { probes },
  done,
) => {
  app.get(
    '/health/live',
    {
      config: { rateLimit: false },
      schema: { response: { 200: z.object({ status: z.literal('ok') }) } },
    },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    {
      config: { rateLimit: false },
      schema: { response: { 200: ReadinessSchema, 503: ReadinessSchema } },
    },
    async (_request, reply) => {
      const results = await Promise.all(
        probes.map(async (probe) => [probe.name, await run(probe)] as const),
      );
      const checks = Object.fromEntries(results);
      const healthy = results.every(([, status]) => status === 'up');
      return reply
        .status(healthy ? 200 : 503)
        .send({ status: healthy ? 'ok' : 'unavailable', checks });
    },
  );

  done();
};
