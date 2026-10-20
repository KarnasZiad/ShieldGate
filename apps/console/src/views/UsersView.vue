<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import AlertMessage from '../components/AlertMessage.vue';
import { api, describeError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Page, PublicUser, Role } from '../lib/types';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const users = ref<PublicUser[]>([]);
const roles = ref<Role[]>([]);
const nextCursor = ref<string | null>(null);
const search = ref('');
const message = ref<{ tone: 'error' | 'success'; text: string } | null>(null);
const form = reactive({ email: '', displayName: '', password: '', role: 'member' });

const PASSWORD_PROBLEMS: Record<string, string> = {
  too_short: '12 caractères minimum',
  too_long: '128 caractères maximum',
  common: 'mot de passe trop courant',
  too_simple: 'pas assez de caractères différents',
  contains_identity: "contient l'e-mail ou le nom",
};

async function load(reset = true) {
  try {
    const params = new URLSearchParams({ limit: '25' });
    if (search.value) params.set('search', search.value);
    if (!reset && nextCursor.value) params.set('cursor', nextCursor.value);
    const page = await api().get<Page<PublicUser>>(`/v1/users?${params.toString()}`);
    users.value = reset ? page.items : [...users.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } catch (error) {
    message.value = { tone: 'error', text: describeError(error) };
  }
}

async function create() {
  message.value = null;
  try {
    const user = await api().post<PublicUser>('/v1/users', {
      email: form.email,
      displayName: form.displayName,
      password: form.password,
      roles: [form.role],
    });
    users.value = [user, ...users.value];
    Object.assign(form, { email: '', displayName: '', password: '', role: 'member' });
    message.value = { tone: 'success', text: `Compte ${user.email} créé.` };
  } catch (error) {
    const problems = (error as { problem?: { problems?: string[] } }).problem?.problems;
    message.value = {
      tone: 'error',
      text: problems
        ? `Mot de passe refusé : ${problems.map((problem) => PASSWORD_PROBLEMS[problem] ?? problem).join(', ')}.`
        : describeError(error, { 409: 'Un compte utilise déjà cet e-mail.' }),
    };
  }
}

async function update(user: PublicUser, changes: Partial<Pick<PublicUser, 'status' | 'roles'>>) {
  try {
    const updated = await api().patch<PublicUser>(`/v1/users/${user.id}`, changes);
    users.value = users.value.map((item) => (item.id === user.id ? updated : item));
    message.value = {
      tone: 'success',
      text: `${user.email} mis à jour : ses sessions ont été fermées.`,
    };
  } catch (error) {
    message.value = { tone: 'error', text: describeError(error) };
  }
}

async function unlock(user: PublicUser) {
  try {
    await api().post(`/v1/users/${user.id}/unlock`);
    message.value = { tone: 'success', text: `${user.email} déverrouillé.` };
  } catch (error) {
    message.value = { tone: 'error', text: describeError(error) };
  }
}

async function revokeSessions(user: PublicUser) {
  try {
    await api().delete(`/v1/users/${user.id}/sessions`);
    message.value = { tone: 'success', text: `Sessions de ${user.email} fermées.` };
  } catch (error) {
    message.value = { tone: 'error', text: describeError(error) };
  }
}

onMounted(async () => {
  await load();
  try {
    roles.value = await api().get<Role[]>('/v1/roles');
  } catch {
    roles.value = [];
  }
});
</script>

<template>
  <section class="flex flex-col gap-6">
    <header class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold">Comptes</h1>
      <form class="ml-auto flex gap-2" @submit.prevent="load()">
        <input
          v-model="search"
          class="input"
          type="search"
          placeholder="Rechercher un e-mail ou un nom"
        />
        <button class="btn-secondary" type="submit">Rechercher</button>
      </form>
    </header>

    <AlertMessage v-if="message" :tone="message.tone">{{ message.text }}</AlertMessage>

    <form
      v-if="session.can('users:write')"
      class="card grid gap-4 sm:grid-cols-5 sm:items-end"
      @submit.prevent="create"
    >
      <label class="flex flex-col gap-1.5">
        <span class="label">E-mail</span>
        <input v-model="form.email" class="input" type="email" required />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="label">Nom</span>
        <input v-model="form.displayName" class="input" required />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="label">Mot de passe initial</span>
        <input
          v-model="form.password"
          class="input"
          type="password"
          autocomplete="new-password"
          required
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="label">Rôle</span>
        <select v-model="form.role" class="input">
          <option v-for="role in roles" :key="role.name" :value="role.name">{{ role.name }}</option>
        </select>
      </label>
      <button class="btn-primary" type="submit">Créer le compte</button>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="data-table">
        <thead>
          <tr>
            <th>Compte</th>
            <th>Rôles</th>
            <th>Statut</th>
            <th>MFA</th>
            <th>Créé le</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>
              <p class="font-medium">{{ user.displayName }}</p>
              <p class="text-xs text-slate-500">{{ user.email }}</p>
            </td>
            <td>{{ user.roles.join(', ') }}</td>
            <td>
              <span :class="user.status === 'active' ? 'text-emerald-700' : 'text-slate-400'">
                {{ user.status === 'active' ? 'actif' : 'désactivé' }}
              </span>
            </td>
            <td>{{ user.mfaEnabled ? 'oui' : 'non' }}</td>
            <td>{{ formatDateTime(user.createdAt) }}</td>
            <td class="flex flex-wrap justify-end gap-2">
              <template v-if="session.can('users:write') && user.id !== session.user?.id">
                <button
                  class="btn-secondary"
                  type="button"
                  @click="
                    update(user, { status: user.status === 'active' ? 'disabled' : 'active' })
                  "
                >
                  {{ user.status === 'active' ? 'Désactiver' : 'Réactiver' }}
                </button>
                <button class="btn-secondary" type="button" @click="unlock(user)">
                  Déverrouiller
                </button>
              </template>
              <button
                v-if="session.can('sessions:revoke')"
                class="btn-secondary"
                type="button"
                @click="revokeSessions(user)"
              >
                Fermer ses sessions
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="nextCursor" class="btn-secondary self-center" type="button" @click="load(false)">
      Afficher plus
    </button>
  </section>
</template>
