import { vi } from 'vitest';
import { ApiError, type ApiClient, configureApi } from '../src/lib/api';

type Handler = (method: string, path: string, body: unknown) => unknown;

/** Installs a fake API client: the handler returns a value, or throws an ApiError. */
export function installFakeApi(handler: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const call = (method: string) =>
    vi.fn((path: string, body?: unknown) => {
      calls.push({ method, path, body });
      try {
        return Promise.resolve(handler(method, path, body));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  const client = {
    get: call('GET'),
    post: call('POST'),
    patch: call('PATCH'),
    put: call('PUT'),
    delete: call('DELETE'),
  };
  configureApi(client as unknown as ApiClient);
  return { client, calls };
}

export function problem(status: number, detail?: string): ApiError {
  return new ApiError(status, { title: `HTTP ${status}`, status, ...(detail ? { detail } : {}) });
}

export const adminSession = {
  status: 'authenticated' as const,
  user: {
    id: 'admin-1',
    email: 'admin@shieldgate.ma',
    displayName: 'Admin',
    roles: ['admin'],
    permissions: ['*'],
  },
  csrfToken: 'csrf-token',
  mfa: true,
  expiresAt: '2026-10-20T21:00:00Z',
};

/** Lets pending promises and Vue updates settle. */
export async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
