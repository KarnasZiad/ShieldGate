import { Redis } from 'ioredis';

export function createRedis(url: string, onError: (error: Error) => void): Redis {
  const client = new Redis(url, { maxRetriesPerRequest: 3 });
  // ioredis reconnects on its own; without a listener each failed attempt is an unhandled event.
  client.on('error', onError);
  return client;
}
