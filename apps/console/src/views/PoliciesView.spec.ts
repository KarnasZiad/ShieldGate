import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { installFakeApi } from '../../test/fake-api';
import { mountView } from '../../test/mount';
import PoliciesView from './PoliciesView.vue';

const policy = {
  id: 'read-invoices',
  description: 'Lecture des factures',
  effect: 'allow',
  actions: ['invoice:read'],
  resources: ['invoice:*'],
  roles: [],
};

describe('PoliciesView', () => {
  it('lists policies and saves the edited one', async () => {
    const { calls } = installFakeApi((method) => (method === 'GET' ? [policy] : policy));
    const { wrapper } = await mountView(PoliciesView);

    expect(wrapper.text()).toContain('read-invoices');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Modifier')
      ?.trigger('click');
    await wrapper.findAll('form')[0]?.trigger('submit');
    await flushPromises();

    expect(calls.find((call) => call.method === 'PUT')).toMatchObject({
      path: '/v1/policies/read-invoices',
      body: { effect: 'allow', actions: ['invoice:read'] },
    });
    expect(wrapper.text()).toContain('Politique read-invoices enregistrée.');
  });

  it('refuses invalid JSON before calling the API', async () => {
    const { calls } = installFakeApi(() => []);
    const { wrapper } = await mountView(PoliciesView);

    await wrapper.findAll('textarea')[0]?.setValue('{ not json');
    await wrapper.findAll('form')[0]?.trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('JSON invalide.');
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('simulates a decision', async () => {
    installFakeApi((method) =>
      method === 'POST'
        ? { decision: 'deny', policyId: 'no-self-approval', reason: 'deny_policy' }
        : [],
    );
    const { wrapper } = await mountView(PoliciesView);

    await wrapper.findAll('form')[1]?.trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Refusé · politique no-self-approval · deny_policy');
    expect(wrapper.text()).toContain('toute demande est refusée par défaut');
  });

  it('deletes a policy', async () => {
    const { calls } = installFakeApi((method) => (method === 'GET' ? [policy] : undefined));
    const { wrapper } = await mountView(PoliciesView);

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Supprimer')
      ?.trigger('click');
    await flushPromises();

    expect(
      calls.some((call) => call.method === 'DELETE' && call.path === '/v1/policies/read-invoices'),
    ).toBe(true);
  });

  it('is read-only without policies:write', async () => {
    installFakeApi(() => [policy]);
    const { wrapper } = await mountView(PoliciesView, { permissions: ['policies:read'] });

    expect(wrapper.text()).not.toContain('Éditer une politique');
    expect(wrapper.text()).not.toContain('Supprimer');
  });
});
