<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import AlertMessage from '../components/AlertMessage.vue';
import { api, describeError } from '../lib/api';
import { ACTION_LABELS, formatDateTime } from '../lib/format';
import type { AuditRecord, Page } from '../lib/types';

const events = ref<AuditRecord[]>([]);
const nextCursor = ref<string | null>(null);
const error = ref<string | null>(null);
const filters = reactive({ action: '', outcome: '', userId: '' });

async function load(reset = true) {
  error.value = null;
  const params = new URLSearchParams({ limit: '50' });
  if (filters.action) params.set('action', filters.action);
  if (filters.outcome) params.set('outcome', filters.outcome);
  if (filters.userId) params.set('userId', filters.userId);
  if (!reset && nextCursor.value) params.set('cursor', nextCursor.value);
  try {
    const page = await api().get<Page<AuditRecord>>(`/v1/audit-events?${params.toString()}`);
    events.value = reset ? page.items : [...events.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } catch (caught) {
    error.value = describeError(caught, {
      400: 'Filtre invalide (identifiant utilisateur au format UUID).',
    });
  }
}

function actor(event: AuditRecord): string {
  return event.user?.email ?? event.user?.id ?? '—';
}

onMounted(load);
</script>

<template>
  <section class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">Journal d’audit</h1>

    <form class="card flex flex-wrap items-end gap-4" @submit.prevent="load()">
      <label class="flex flex-col gap-1.5">
        <span class="label">Événement</span>
        <select v-model="filters.action" class="input">
          <option value="">Tous</option>
          <option v-for="(label, action) in ACTION_LABELS" :key="action" :value="action">
            {{ label }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="label">Résultat</span>
        <select v-model="filters.outcome" class="input">
          <option value="">Tous</option>
          <option value="success">Succès</option>
          <option value="failure">Échec</option>
        </select>
      </label>
      <label class="flex flex-1 flex-col gap-1.5">
        <span class="label">Identifiant d’utilisateur</span>
        <input v-model.trim="filters.userId" class="input font-mono" placeholder="UUID" />
      </label>
      <button class="btn-primary" type="submit">Filtrer</button>
    </form>

    <AlertMessage v-if="error">{{ error }}</AlertMessage>

    <div class="card overflow-x-auto p-0">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Événement</th>
            <th>Résultat</th>
            <th>Acteur</th>
            <th>Cible</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in events" :key="event.id">
            <td class="whitespace-nowrap">{{ formatDateTime(event['@timestamp']) }}</td>
            <td>
              {{ ACTION_LABELS[event.event.action] ?? event.event.action }}
              <span v-if="event.event.reason" class="block text-xs text-slate-500">{{
                event.event.reason
              }}</span>
            </td>
            <td>
              <span
                :class="event.event.outcome === 'success' ? 'text-emerald-700' : 'text-red-700'"
              >
                {{ event.event.outcome === 'success' ? 'succès' : 'échec' }}
              </span>
            </td>
            <td>{{ actor(event) }}</td>
            <td>{{ event.user?.target?.email ?? event.user?.target?.id ?? '' }}</td>
            <td class="font-mono text-xs">{{ event.source?.ip ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="events.length === 0" class="p-6 text-center text-sm text-slate-500">
        Aucun événement.
      </p>
    </div>
    <button v-if="nextCursor" class="btn-secondary self-center" type="button" @click="load(false)">
      Afficher plus
    </button>
  </section>
</template>
