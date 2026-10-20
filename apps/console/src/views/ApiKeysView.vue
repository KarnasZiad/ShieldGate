<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import AlertMessage from '../components/AlertMessage.vue';
import { api, describeError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { ApiKeyView } from '../lib/types';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const keys = ref<ApiKeyView[]>([]);
const created = ref<string | null>(null);
const copied = ref(false);
const message = ref<string | null>(null);
const form = reactive({ name: '', expiresInDays: 90 });

async function load() {
  try {
    keys.value = await api().get<ApiKeyView[]>('/v1/api-keys');
  } catch (error) {
    message.value = describeError(error);
  }
}

async function create() {
  message.value = null;
  copied.value = false;
  try {
    const result = await api().post<ApiKeyView & { key: string }>('/v1/api-keys', {
      name: form.name,
      scopes: ['authorize'],
      expiresInDays: form.expiresInDays,
    });
    created.value = result.key;
    const { key: _secret, ...view } = result;
    keys.value = [view, ...keys.value];
    form.name = '';
  } catch (error) {
    message.value = describeError(error);
  }
}

async function copy() {
  if (!created.value) return;
  await navigator.clipboard.writeText(created.value);
  copied.value = true;
}

async function revoke(key: ApiKeyView) {
  try {
    await api().delete(`/v1/api-keys/${key.id}`);
    await load();
  } catch (error) {
    message.value = describeError(error);
  }
}

onMounted(load);
</script>

<template>
  <section class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">Clés API</h1>
    <AlertMessage v-if="message">{{ message }}</AlertMessage>

    <div v-if="created" class="card flex flex-col gap-3 border-amber-300 bg-amber-50">
      <p class="font-medium text-amber-900">
        Copiez cette clé maintenant : elle ne sera plus jamais affichée.
      </p>
      <code class="rounded bg-white p-2 font-mono text-sm break-all">{{ created }}</code>
      <div class="flex gap-2">
        <button class="btn-primary" type="button" @click="copy">
          {{ copied ? 'Copiée' : 'Copier' }}
        </button>
        <button class="btn-secondary" type="button" @click="created = null">
          J’ai enregistré la clé
        </button>
      </div>
    </div>

    <form
      v-if="session.can('api-keys:write')"
      class="card flex flex-wrap items-end gap-4"
      @submit.prevent="create"
    >
      <label class="flex flex-1 flex-col gap-1.5">
        <span class="label">Application</span>
        <input
          v-model="form.name"
          class="input"
          maxlength="100"
          placeholder="Back-office facturation"
          required
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="label">Expiration (jours)</span>
        <input
          v-model.number="form.expiresInDays"
          class="input w-32"
          type="number"
          min="1"
          max="365"
          required
        />
      </label>
      <button class="btn-primary" type="submit">Émettre une clé</button>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="data-table">
        <thead>
          <tr>
            <th>Application</th>
            <th>Préfixe</th>
            <th>Dernière utilisation</th>
            <th>Expiration</th>
            <th>Statut</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="key in keys" :key="key.id">
            <td class="font-medium">{{ key.name }}</td>
            <td class="font-mono text-xs">sg_live_{{ key.prefix }}_…</td>
            <td>{{ formatDateTime(key.lastUsedAt) }}</td>
            <td>{{ formatDateTime(key.expiresAt) }}</td>
            <td>
              <span :class="key.revokedAt ? 'text-slate-400' : 'text-emerald-700'">
                {{ key.revokedAt ? 'révoquée' : 'active' }}
              </span>
            </td>
            <td class="text-right">
              <button
                v-if="!key.revokedAt && session.can('api-keys:write')"
                class="btn-danger"
                type="button"
                @click="revoke(key)"
              >
                Révoquer
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
