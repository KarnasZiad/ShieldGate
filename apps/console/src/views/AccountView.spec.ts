import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { installFakeApi, problem } from '../../test/fake-api';
import { mountView } from '../../test/mount';
import AccountView from './AccountView.vue';

vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,QR') },
}));

const profile = (mfaEnabled: boolean) => ({
  id: 'admin-1',
  email: 'admin@shieldgate.ma',
  displayName: 'Admin',
  status: 'active',
  roles: ['admin'],
  mfaEnabled,
  createdAt: '2026-10-20T09:00:00Z',
});

const sessions = [
  {
    id: 'a'.repeat(64),
    current: true,
    ip: '203.0.113.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/141.0',
    mfa: true,
    createdAt: '2026-10-20T09:00:00Z',
    lastSeenAt: '2026-10-20T09:10:00Z',
    expiresAt: '2026-10-20T21:00:00Z',
  },
  {
    id: 'b'.repeat(64),
    current: false,
    ip: '198.51.100.7',
    userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1',
    mfa: false,
    createdAt: '2026-10-19T09:00:00Z',
    lastSeenAt: '2026-10-19T09:10:00Z',
    expiresAt: '2026-10-19T21:00:00Z',
  },
];

describe('AccountView', () => {
  it('enrolls an authenticator with a QR code and a first code', async () => {
    let enabled = false;
    const { calls } = installFakeApi((method, path) => {
      if (path === '/v1/me') return profile(enabled);
      if (path === '/v1/me/sessions') return sessions;
      if (path === '/v1/me/mfa/totp')
        return {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/x',
          expiresInSeconds: 600,
        };
      enabled = true;
      return undefined;
    });
    const { wrapper } = await mountView(AccountView);
    expect(wrapper.text()).toContain('Non activée');

    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('Activer la double'))
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,QR');
    expect(wrapper.text()).toContain('JBSWY3DPEHPK3PXP');

    await wrapper.get('input[inputmode="numeric"]').setValue('123456');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(calls.find((call) => call.path === '/v1/me/mfa/totp/activate')?.body).toEqual({
      code: '123456',
    });
    expect(wrapper.text()).toContain('Double authentification activée.');
  });

  it('explains a wrong activation code', async () => {
    installFakeApi((_method, path) => {
      if (path === '/v1/me') return profile(false);
      if (path === '/v1/me/sessions') return [];
      if (path === '/v1/me/mfa/totp')
        return { secret: 'X', otpauthUri: 'otpauth://totp/x', expiresInSeconds: 600 };
      throw problem(422);
    });
    const { wrapper } = await mountView(AccountView);
    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('Activer la double'))
      ?.trigger('click');
    await flushPromises();

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Code invalide, réessayez.');
  });

  it('requires the password to disable MFA', async () => {
    const { calls } = installFakeApi((_method, path) => {
      if (path === '/v1/me') return profile(true);
      if (path === '/v1/me/sessions') return [];
      throw problem(403);
    });
    const { wrapper } = await mountView(AccountView);

    await wrapper.get('input[type="password"]').setValue('wrong');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(calls.at(-1)).toMatchObject({
      path: '/v1/me/mfa/totp/disable',
      body: { password: 'wrong' },
    });
    expect(wrapper.get('[role="alert"]').text()).toBe('Mot de passe incorrect.');
  });

  it('lists sessions and closes another device', async () => {
    const { calls } = installFakeApi((_method, path) => {
      if (path === '/v1/me') return profile(true);
      if (path === '/v1/me/sessions') return sessions;
      return undefined;
    });
    const { wrapper } = await mountView(AccountView);

    expect(wrapper.text()).toContain('Chrome · Windows');
    expect(wrapper.text()).toContain('cette session');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Fermer')
      ?.trigger('click');
    await flushPromises();

    expect(calls.at(-1)).toMatchObject({
      method: 'DELETE',
      path: `/v1/me/sessions/${'b'.repeat(64)}`,
    });
    expect(wrapper.text()).not.toContain('198.51.100.7');
  });
});
