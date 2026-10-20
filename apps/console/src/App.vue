<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useSessionStore } from './stores/session';

const session = useSessionStore();
const router = useRouter();

const navigation = computed(() =>
  [
    { to: '/account', label: 'Mon compte', permission: null },
    { to: '/users', label: 'Comptes', permission: 'users:read' },
    { to: '/api-keys', label: 'Clés API', permission: 'api-keys:read' },
    { to: '/policies', label: 'Politiques', permission: 'policies:read' },
    { to: '/audit', label: 'Audit', permission: 'audit:read' },
  ].filter((item) => item.permission === null || session.can(item.permission)),
);

async function signOut() {
  await session.logout();
  await router.push('/login');
}
</script>

<template>
  <div class="min-h-screen">
    <header v-if="session.authenticated" class="border-b border-slate-200 bg-shield-900 text-white">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
        <span class="font-semibold tracking-wide">ShieldGate</span>
        <nav aria-label="Navigation principale" class="flex flex-wrap gap-1">
          <RouterLink
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            class="rounded-md px-3 py-1.5 text-sm text-shield-100 hover:bg-white/10"
            active-class="bg-white/15 text-white"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <div class="ml-auto flex items-center gap-3 text-sm">
          <span>{{ session.user?.email }}</span>
          <span
            v-if="!session.mfa"
            class="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200"
            title="Session ouverte sans second facteur"
          >
            sans MFA
          </span>
          <button type="button" class="rounded-md px-3 py-1.5 hover:bg-white/10" @click="signOut">
            Déconnexion
          </button>
        </div>
      </div>
    </header>
    <main :class="session.authenticated ? 'mx-auto max-w-7xl px-4 py-6' : ''">
      <RouterView />
    </main>
  </div>
</template>
