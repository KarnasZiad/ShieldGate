import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { installFakeApi } from '../../test/fake-api';
import { mountView } from '../../test/mount';
import UsersView from './UsersView.vue';

const amina = {
  id: 'u-1',
  email: 'amina@exemple.ma',
  displayName: 'Amina Benali',
  status: 'active',
  roles: ['member'],
  mfaEnabled: false,
  createdAt: '2026-10-20T09:00:00Z',
};

function handler(method: string, path: string) {
  if (method === 'GET' && path.startsWith('/v1/users')) return { items: [amina], nextCursor: null };
  if (path === '/v1/roles') return [{ name: 'member', description: '', permissions: [] }];
  if (method === 'PATCH') return { ...amina, status: 'disabled' };
  return { ...amina, id: 'u-2', email: 'youssef@exemple.ma' };
}

describe('UsersView', () => {
  it('lists the accounts', async () => {
    installFakeApi(handler);
    const { wrapper } = await mountView(UsersView);

    expect(wrapper.text()).toContain('amina@exemple.ma');
    expect(wrapper.text()).toContain('actif');
  });

  it('hides write actions without users:write', async () => {
    installFakeApi(handler);
    const { wrapper } = await mountView(UsersView, { permissions: ['users:read'] });

    expect(wrapper.find('form.card').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Désactiver');
  });

  it('creates an account and explains a refused password', async () => {
    const { calls } = installFakeApi(handler);
    const { wrapper } = await mountView(UsersView);
    const form = wrapper.get('form.card');
    await form.get('input[type="email"]').setValue('youssef@exemple.ma');
    await form.findAll('input')[1]?.setValue('Youssef Alaoui');
    await form.get('input[type="password"]').setValue('le thé à la menthe');
    await form.trigger('submit');
    await flushPromises();

    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      email: 'youssef@exemple.ma',
      displayName: 'Youssef Alaoui',
      password: 'le thé à la menthe',
      roles: ['member'],
    });
    expect(wrapper.text()).toContain('Compte youssef@exemple.ma créé.');

    installFakeApi((method, path) => {
      if (method === 'POST') {
        throw new ApiError(422, {
          title: 'Unprocessable',
          status: 422,
          problems: ['common', 'too_short'],
        });
      }
      return handler(method, path);
    });
    await form.trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Mot de passe refusé : mot de passe trop courant, 12 caractères minimum.',
    );
  });

  it('disables an account', async () => {
    const { calls } = installFakeApi(handler);
    const { wrapper } = await mountView(UsersView);

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Désactiver')
      ?.trigger('click');
    await flushPromises();

    expect(calls.find((call) => call.method === 'PATCH')).toEqual({
      method: 'PATCH',
      path: '/v1/users/u-1',
      body: { status: 'disabled' },
    });
    expect(wrapper.text()).toContain('désactivé');
  });

  it('unlocks an account and closes its sessions', async () => {
    const { calls } = installFakeApi(handler);
    const { wrapper } = await mountView(UsersView);

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Déverrouiller')
      ?.trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Fermer ses sessions')
      ?.trigger('click');
    await flushPromises();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(
      expect.arrayContaining(['POST /v1/users/u-1/unlock', 'DELETE /v1/users/u-1/sessions']),
    );
  });
});
