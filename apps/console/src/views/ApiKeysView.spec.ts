import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../../test/fake-api';
import { mountView } from '../../test/mount';
import ApiKeysView from './ApiKeysView.vue';

const key = {
  id: 'k-1',
  name: 'Facturation',
  prefix: 'abcdefgh',
  ownerId: 'admin-1',
  scopes: ['authorize'],
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-10-20T09:00:00Z',
};

describe('ApiKeysView', () => {
  it('shows a new key once, lets the user copy it, then forgets it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const fullKey = 'sg_live_abcdefgh_secret';
    const { calls } = installFakeApi((method) =>
      method === 'POST' ? { ...key, key: fullKey } : [],
    );
    const { wrapper } = await mountView(ApiKeysView);

    await wrapper.get('input[maxlength="100"]').setValue('Facturation');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Facturation',
      scopes: ['authorize'],
      expiresInDays: 90,
    });
    expect(wrapper.text()).toContain(fullKey);
    expect(wrapper.text()).toContain('sg_live_abcdefgh_…');

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Copier')
      ?.trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(fullKey);

    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('J’ai enregistré'))
      ?.trigger('click');
    expect(wrapper.text()).not.toContain(fullKey);
  });

  it('revokes a key', async () => {
    const { calls } = installFakeApi((method) => (method === 'GET' ? [key] : undefined));
    const { wrapper } = await mountView(ApiKeysView);

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Révoquer')
      ?.trigger('click');
    await flushPromises();

    expect(calls.some((call) => call.method === 'DELETE' && call.path === '/v1/api-keys/k-1')).toBe(
      true,
    );
  });
});
