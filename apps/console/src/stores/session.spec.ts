import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminSession, installFakeApi, problem } from '../../test/fake-api';
import { useSessionStore } from './session';

describe('session store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('restores an existing session and exposes its permissions', async () => {
    installFakeApi(() => adminSession);
    const session = useSessionStore();

    await session.restore();

    expect(session.authenticated).toBe(true);
    expect(session.csrfToken).toBe('csrf-token');
    expect(session.can('users:write')).toBe(true);
  });

  it('becomes anonymous without a valid session', async () => {
    installFakeApi(() => {
      throw problem(401);
    });
    const session = useSessionStore();

    await session.restore();

    expect(session.status).toBe('anonymous');
    expect(session.can('users:read')).toBe(false);
  });

  it('rethrows unexpected errors while restoring', async () => {
    installFakeApi(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(useSessionStore().restore()).rejects.toThrow('Failed to fetch');
  });

  it('signs in in two steps when MFA is enabled', async () => {
    const { calls } = installFakeApi((_method, path) =>
      path === '/v1/auth/login'
        ? { status: 'mfa_required', challengeId: 'challenge-1', expiresIn: 300 }
        : adminSession,
    );
    const session = useSessionStore();

    await expect(session.login('admin@shieldgate.ma', 'secret')).resolves.toBe('mfa');
    expect(session.authenticated).toBe(false);

    await session.verifyMfa('123456');

    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: '/v1/auth/mfa',
      body: { challengeId: 'challenge-1', code: '123456' },
    });
    expect(session.authenticated).toBe(true);
    expect(session.challengeId).toBeNull();
  });

  it('signs in directly without MFA and signs out', async () => {
    installFakeApi((_method, path) => (path === '/v1/auth/logout' ? undefined : adminSession));
    const session = useSessionStore();

    await expect(session.login('admin@shieldgate.ma', 'secret')).resolves.toBe('done');
    await session.logout();

    expect(session.status).toBe('anonymous');
    expect(session.csrfToken).toBeNull();
  });

  it('refuses a code without a pending sign-in', async () => {
    installFakeApi(() => adminSession);

    await expect(useSessionStore().verifyMfa('123456')).rejects.toThrow('No sign-in in progress');
  });
});
