import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { adminSession, installFakeApi, problem } from '../test/fake-api';
import { createAppRouter, safeRedirect } from './router';

const analystSession = {
  ...adminSession,
  user: {
    ...adminSession.user,
    roles: ['security-analyst'],
    permissions: ['audit:read', 'users:read'],
  },
};

describe('router guards', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  async function navigate(path: string) {
    const router = createAppRouter(createMemoryHistory());
    await router.push(path);
    return router.currentRoute.value;
  }

  it('sends anonymous visitors to the login page and remembers the target', async () => {
    installFakeApi(() => {
      throw problem(401);
    });

    const route = await navigate('/audit?outcome=failure');

    expect(route.path).toBe('/login');
    expect(route.query.redirect).toBe('/audit?outcome=failure');
  });

  it('opens pages allowed by the permissions of the session', async () => {
    installFakeApi(() => analystSession);

    expect((await navigate('/audit')).path).toBe('/audit');
  });

  it('falls back to the account page without the required permission', async () => {
    installFakeApi(() => analystSession);

    expect((await navigate('/policies')).path).toBe('/account');
  });

  it('skips the login page when already signed in', async () => {
    installFakeApi(() => adminSession);

    expect((await navigate('/login?redirect=/users')).path).toBe('/users');
  });
});

describe('safeRedirect', () => {
  it.each([
    ['/users', '/users'],
    ['//evil.example', '/account'],
    ['https://evil.example', '/account'],
    [undefined, '/account'],
  ])('%s → %s', (target, expected) => {
    expect(safeRedirect(target)).toBe(expected);
  });
});
