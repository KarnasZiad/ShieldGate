<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AlertMessage from '../components/AlertMessage.vue';
import { api, describeError } from '../lib/api';
import type { Decision, Policy } from '../lib/types';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const policies = ref<Policy[]>([]);
const message = ref<{ tone: 'error' | 'success'; text: string } | null>(null);

const EXAMPLE_POLICY = {
  description: 'Un comptable ne peut pas approuver sa propre facture',
  effect: 'deny',
  actions: ['invoice:approve'],
  resources: ['invoice:*'],
  condition: { equals: [{ ref: 'resource.attributes.ownerId' }, { ref: 'subject.id' }] },
};
const EXAMPLE_REQUEST = {
  subject: { id: 'u-42', roles: ['accountant'] },
  action: 'invoice:approve',
  resource: { type: 'invoice', id: 'inv-7', attributes: { ownerId: 'u-42' } },
};

const policyId = ref('no-self-approval');
const editor = ref(JSON.stringify(EXAMPLE_POLICY, null, 2));
const simulation = ref(JSON.stringify(EXAMPLE_REQUEST, null, 2));
const decision = ref<Decision | null>(null);

function parse(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error('JSON invalide');
  }
}

async function load() {
  try {
    policies.value = await api().get<Policy[]>('/v1/policies');
  } catch (error) {
    message.value = { tone: 'error', text: describeError(error) };
  }
}

function edit(policy: Policy) {
  const { id, ...body } = policy;
  policyId.value = id;
  editor.value = JSON.stringify(body, null, 2);
}

async function save() {
  message.value = null;
  try {
    await api().put(`/v1/policies/${policyId.value}`, parse(editor.value));
    message.value = { tone: 'success', text: `Politique ${policyId.value} enregistrée.` };
    await load();
  } catch (error) {
    message.value = {
      tone: 'error',
      text:
        error instanceof Error && error.message === 'JSON invalide'
          ? 'JSON invalide.'
          : describeError(error),
    };
  }
}

async function remove(policy: Policy) {
  try {
    await api().delete(`/v1/policies/${policy.id}`);
    await load();
  } catch (error) {
    message.value = { tone: 'error', text: describeError(error) };
  }
}

async function simulate() {
  decision.value = null;
  try {
    decision.value = await api().post<Decision>('/v1/authorize', parse(simulation.value));
  } catch (error) {
    message.value = {
      tone: 'error',
      text:
        error instanceof Error && error.message === 'JSON invalide'
          ? 'JSON invalide.'
          : describeError(error),
    };
  }
}

onMounted(load);
</script>

<template>
  <section class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">Politiques d’autorisation</h1>
    <AlertMessage v-if="message" :tone="message.tone">{{ message.text }}</AlertMessage>

    <div class="card overflow-x-auto p-0">
      <table class="data-table">
        <thead>
          <tr>
            <th>Identifiant</th>
            <th>Effet</th>
            <th>Actions</th>
            <th>Ressources</th>
            <th>Rôles</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="policy in policies" :key="policy.id">
            <td>
              <p class="font-mono text-xs">{{ policy.id }}</p>
              <p class="text-xs text-slate-500">{{ policy.description }}</p>
            </td>
            <td>
              <span :class="policy.effect === 'deny' ? 'text-red-700' : 'text-emerald-700'">{{
                policy.effect
              }}</span>
            </td>
            <td class="font-mono text-xs">{{ policy.actions.join(', ') }}</td>
            <td class="font-mono text-xs">{{ policy.resources.join(', ') }}</td>
            <td>{{ policy.roles.join(', ') || 'tous' }}</td>
            <td class="flex justify-end gap-2">
              <button class="btn-secondary" type="button" @click="edit(policy)">Modifier</button>
              <button
                v-if="session.can('policies:write')"
                class="btn-danger"
                type="button"
                @click="remove(policy)"
              >
                Supprimer
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="policies.length === 0" class="p-6 text-center text-sm text-slate-500">
        Aucune politique : toute demande est refusée par défaut.
      </p>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <form
        v-if="session.can('policies:write')"
        class="card flex flex-col gap-3"
        @submit.prevent="save"
      >
        <h2 class="font-medium">Éditer une politique</h2>
        <label class="flex flex-col gap-1.5">
          <span class="label">Identifiant</span>
          <input
            v-model="policyId"
            class="input font-mono"
            pattern="[a-z0-9][a-z0-9-]{1,63}"
            required
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="label">Définition (JSON)</span>
          <textarea v-model="editor" class="input h-72 py-2 font-mono text-xs" spellcheck="false" />
        </label>
        <button class="btn-primary self-start" type="submit">Enregistrer</button>
      </form>

      <form
        v-if="session.can('authz:evaluate')"
        class="card flex flex-col gap-3"
        @submit.prevent="simulate"
      >
        <h2 class="font-medium">Simuler une décision</h2>
        <label class="flex flex-col gap-1.5">
          <span class="label">Requête (JSON)</span>
          <textarea
            v-model="simulation"
            class="input h-72 py-2 font-mono text-xs"
            spellcheck="false"
          />
        </label>
        <button class="btn-secondary self-start" type="submit">Évaluer</button>
        <AlertMessage v-if="decision" :tone="decision.decision === 'allow' ? 'success' : 'error'">
          {{ decision.decision === 'allow' ? 'Autorisé' : 'Refusé' }}
          · politique {{ decision.policyId ?? 'aucune' }} · {{ decision.reason }}
        </AlertMessage>
      </form>
    </div>
  </section>
</template>
