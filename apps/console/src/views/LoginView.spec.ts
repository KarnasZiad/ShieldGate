import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { adminSession, installFakeApi, problem } from '../../test/fake-api';
import { mountView } from '../../test/mount';
import LoginView from './LoginView.vue';

async function signIn(handler: Parameters<typeof installFakeApi>[0], route = '/login') {
  const fake = installFakeApi(handler);
  const mounted = await mountView(LoginView, { permissions: null, route });
  await mounted.wrapper.get('input[type="email"]').setValue('admin@shieldgate.ma');
  await mounted.wrapper.get('input[type="password"]').setValue('le thé à la menthe');
  await mounted.wrapper.get('form').trigger('submit');
  await flushPromises();
  return { ...mounted, ...fake };
}

describe('LoginView', () => {
  it('signs in and goes back to the requested page', async () => {
    const { router, session } = await signIn(
      (_method, path) =>
        path === '/v1/auth/login' ? adminSession : { items: [], nextCursor: null },
      '/login?redirect=/audit',
    );

    expect(session.authenticated).toBe(true);
    // The target view is lazy-loaded: the navigation ends once its chunk is imported.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/audit');
    });
  });

  it('asks for the TOTP code when MFA is enabled', async () => {
    const { wrapper, calls, router } = await signIn((_method, path) => {
      if (path === '/v1/auth/login')
        return { status: 'mfa_required', challengeId: 'c-1', expiresIn: 300 };
      if (path === '/v1/auth/mfa') return adminSession;
      return {};
    });

    expect(wrapper.text()).toContain('Vérification en deux étapes');
    await wrapper.get('input[inputmode="numeric"]').setValue('123456');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(calls.find((call) => call.path === '/v1/auth/mfa')?.body).toEqual({
      challengeId: 'c-1',
      code: '123456',
    });
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/account');
    });
  });

  it('explains wrong credentials and wrong codes', async () => {
    const wrongPassword = await signIn(() => {
      throw problem(401);
    });
    expect(wrongPassword.wrapper.get('[role="alert"]').text()).toBe(
      'E-mail ou mot de passe incorrect.',
    );

    const wrongCode = await signIn((_method, path) => {
      if (path === '/v1/auth/login')
        return { status: 'mfa_required', challengeId: 'c-1', expiresIn: 300 };
      throw problem(401);
    });
    await wrongCode.wrapper.get('input[inputmode="numeric"]').setValue('000000');
    await wrongCode.wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrongCode.wrapper.get('[role="alert"]').text()).toBe('Code invalide ou expiré.');
  });

  it('never redirects to another site', async () => {
    const { router } = await signIn(
      (_method, path) => (path === '/v1/auth/login' ? adminSession : {}),
      '/login?redirect=//evil.example',
    );

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/account');
    });
  });
});
