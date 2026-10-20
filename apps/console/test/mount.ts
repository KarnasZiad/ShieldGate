import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { Component } from 'vue';
import { createMemoryHistory } from 'vue-router';
import { createAppRouter } from '../src/router';
import { useSessionStore } from '../src/stores/session';
import { adminSession } from './fake-api';

interface MountOptions {
  /** Permissions of the signed-in user; null for an anonymous visitor. */
  permissions?: string[] | null;
  route?: string;
}

/** Mounts a view with Pinia, the real router (memory history) and a signed-in session. */
export async function mountView(
  view: Component,
  { permissions = ['*'], route = '/' }: MountOptions = {},
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  if (permissions === null) {
    session.reset();
  } else {
    session.$patch({
      status: 'authenticated',
      user: { ...adminSession.user, permissions },
      csrfToken: 'csrf-token',
      mfa: true,
    });
  }
  const router = createAppRouter(createMemoryHistory());
  await router.push(route);
  await router.isReady();
  const wrapper = mount(view, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return { wrapper, router, session };
}
