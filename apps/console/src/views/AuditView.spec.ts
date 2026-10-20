import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { installFakeApi, problem } from '../../test/fake-api';
import { mountView } from '../../test/mount';
import AuditView from './AuditView.vue';

const event = (id: string, outcome: 'success' | 'failure') => ({
  id,
  '@timestamp': '2026-10-20T09:30:00Z',
  event: {
    action: 'user.login',
    category: ['authentication'],
    outcome,
    reason: outcome === 'failure' ? 'invalid_credentials' : undefined,
  },
  user: { email: 'amina@exemple.ma' },
  source: { ip: '196.12.4.8' },
});

describe('AuditView', () => {
  it('shows the events with readable labels and loads more with the cursor', async () => {
    const { calls } = installFakeApi((_method, path) =>
      path.includes('cursor=next')
        ? { items: [event('e-2', 'failure')], nextCursor: null }
        : { items: [event('e-1', 'success')], nextCursor: 'next' },
    );
    const { wrapper } = await mountView(AuditView);

    expect(wrapper.text()).toContain('Connexion');
    expect(wrapper.text()).toContain('196.12.4.8');

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Afficher plus')
      ?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('invalid_credentials');
    expect(calls.at(-1)?.path).toContain('cursor=next');
  });

  it('applies the filters', async () => {
    const { calls } = installFakeApi(() => ({ items: [], nextCursor: null }));
    const { wrapper } = await mountView(AuditView);

    await wrapper.findAll('select')[0]?.setValue('user.locked');
    await wrapper.findAll('select')[1]?.setValue('failure');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(calls.at(-1)?.path).toBe('/v1/audit-events?limit=50&action=user.locked&outcome=failure');
    expect(wrapper.text()).toContain('Aucun événement.');
  });

  it('explains an invalid filter', async () => {
    installFakeApi(() => {
      throw problem(400);
    });
    const { wrapper } = await mountView(AuditView);

    expect(wrapper.get('[role="alert"]').text()).toContain('UUID');
  });
});
