import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { adminSession, installFakeApi } from '../test/fake-api';
import { mountView } from '../test/mount';
import App from './App.vue';

/** The account page is the landing page: it loads the profile and the sessions. */
function accountApi(_method: string, path: string) {
  if (path === '/v1/me') return { ...adminSession.user, status: 'active', mfaEnabled: true };
  if (path === '/v1/me/sessions') return [];
  return undefined;
}

describe('App shell', () => {
  it('shows only the sections allowed by the permissions', async () => {
    installFakeApi(accountApi);
    const { wrapper } = await mountView(App, { permissions: ['audit:read'] });

    const links = wrapper.findAll('nav a').map((link) => link.text());
    expect(links).toEqual(['Mon compte', 'Audit']);
  });

  it('warns about a session opened without MFA and signs out', async () => {
    const { calls } = installFakeApi(accountApi);
    const { wrapper, session, router } = await mountView(App, { route: '/account' });
    session.$patch({ mfa: false });
    await flushPromises();

    expect(wrapper.get('header').text()).toContain('sans MFA');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Déconnexion')
      ?.trigger('click');
    await flushPromises();

    expect(calls.at(-1)?.path).toBe('/v1/auth/logout');
    expect(session.status).toBe('anonymous');
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/login');
    });
  });
});
