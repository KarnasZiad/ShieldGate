import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { HttpProblem } from '../lib/problem.js';

export interface RateLimitOptions {
  /** Shared store so every API instance counts the same requests. In-memory when omitted (tests). */
  redis?: Redis;
  max?: number;
}

/** Global per-IP limit; sensitive routes set a stricter `config.rateLimit` (threats S1, D1). */
export const rateLimitPlugin = fp(async (app: FastifyInstance, options: RateLimitOptions) => {
  await app.register(rateLimit, {
    global: true,
    max: options.max ?? 300,
    timeWindow: '1 minute',
    nameSpace: 'sg:rate-limit:',
    ...(options.redis ? { redis: options.redis } : {}),
    errorResponseBuilder: (_request, context) =>
      new HttpProblem(429, 'Too Many Requests', `Rate limit exceeded, retry in ${context.after}`),
  });
});
