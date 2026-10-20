<script setup lang="ts">
import QRCode from 'qrcode';
import { onMounted, ref } from 'vue';
import AlertMessage from '../components/AlertMessage.vue';
import { api, describeError } from '../lib/api';
import { describeUserAgent, formatDateTime } from '../lib/format';
import type { PublicUser, SessionView, TotpEnrollment } from '../lib/types';

const profile = ref<PublicUser | null>(null);
const sessions = ref<SessionView[]>([]);
const enrollment = ref<TotpEnrollment | null>(null);
const qrCode = ref<string | null>(null);
const code = ref('');
const password = ref('');
const message = ref<{ tone: 'error' | 'success'; text: string } | null>(null);

async function load() {
  try {
    [profile.value, sessions.value] = await Promise.all([
      api().get<PublicUser>('/v1/me'),
      api().get<SessionView[]>('/v1/me/sessions'),
    ]);
  } catch (error) {
    message.value = { tone: 'error', text: describeError(error) };
  }
}

async function startEnrollment() {
  message.value = null;
  try {
    enrollment.value = await api().post<TotpEnrollment>('/v1/me/mfa/totp');
    qrCode.value = await QRCode.toDataURL(enrollment.value.otpauthUri, { margin: 1, width: 192 });
  } catch (error) {
    message.value = { tone: 'error', text: describeError(error) };
  }
}

async function activate() {
  try {
    await api().post('/v1/me/mfa/totp/activate', { code: code.value });
    enrollment.value = null;
    qrCode.value = null;
    code.value = '';
    message.value = { tone: 'success', text: 'Double authentification activée.' };
    await load();
  } catch (error) {
    message.value = {
      tone: 'error',
      text: describeError(error, { 422: 'Code invalide, réessayez.' }),
    };
  }
}

async function disable() {
  try {
    await api().post('/v1/me/mfa/totp/disable', { password: password.value });
    password.value = '';
    message.value = { tone: 'success', text: 'Double authentification désactivée.' };
    await load();
  } catch (error) {
    message.value = {
      tone: 'error',
      text: describeError(error, { 403: 'Mot de passe incorrect.' }),
    };
  }
}

async function revoke(session: SessionView) {
  try {
    await api().delete(`/v1/me/sessions/${session.id}`);
    sessions.value = sessions.value.filter((item) => item.id !== session.id);
  } catch (error) {
    message.value = { tone: 'error', text: describeError(error) };
  }
}

onMounted(load);
</script>

<template>
  <section class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">Mon compte</h1>
    <AlertMessage v-if="message" :tone="message.tone">{{ message.text }}</AlertMessage>

    <div v-if="profile" class="card flex flex-col gap-1">
      <p class="font-medium">{{ profile.displayName }}</p>
      <p class="text-sm text-slate-500">
        {{ profile.email }} · rôles : {{ profile.roles.join(', ') || 'aucun' }}
      </p>
    </div>

    <div class="card flex flex-col gap-4">
      <h2 class="font-medium">Double authentification (TOTP)</h2>
      <template v-if="profile?.mfaEnabled">
        <p class="text-sm text-emerald-700">
          Activée. Votre compte demande un code à chaque connexion.
        </p>
        <form class="flex flex-wrap items-end gap-3" @submit.prevent="disable">
          <label class="flex flex-col gap-1.5">
            <span class="label">Mot de passe pour confirmer</span>
            <input
              v-model="password"
              class="input"
              type="password"
              autocomplete="current-password"
              required
            />
          </label>
          <button class="btn-danger" type="submit">Désactiver</button>
        </form>
      </template>
      <template v-else-if="enrollment">
        <p class="text-sm text-slate-600">
          Scannez ce QR code avec votre application d’authentification, puis saisissez le premier
          code.
        </p>
        <img v-if="qrCode" :src="qrCode" alt="QR code d’enrôlement TOTP" class="h-48 w-48" />
        <p class="font-mono text-xs break-all text-slate-500">Clé : {{ enrollment.secret }}</p>
        <form class="flex flex-wrap items-end gap-3" @submit.prevent="activate">
          <label class="flex flex-col gap-1.5">
            <span class="label">Code à 6 chiffres</span>
            <input
              v-model="code"
              class="input font-mono"
              inputmode="numeric"
              pattern="[0-9]{6}"
              maxlength="6"
              required
            />
          </label>
          <button class="btn-primary" type="submit">Activer</button>
        </form>
      </template>
      <template v-else>
        <p class="text-sm text-amber-700">
          Non activée : votre compte n’est protégé que par un mot de passe.
        </p>
        <button class="btn-primary self-start" type="button" @click="startEnrollment">
          Activer la double authentification
        </button>
      </template>
    </div>

    <div class="card overflow-x-auto p-0">
      <h2 class="p-6 pb-3 font-medium">Sessions actives</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Appareil</th>
            <th>Adresse IP</th>
            <th>Dernière activité</th>
            <th>MFA</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="session in sessions" :key="session.id">
            <td>
              {{ describeUserAgent(session.userAgent) }}
              <span
                v-if="session.current"
                class="ml-2 rounded-full bg-shield-100 px-2 py-0.5 text-xs text-shield-700"
              >
                cette session
              </span>
            </td>
            <td class="font-mono text-xs">{{ session.ip }}</td>
            <td>{{ formatDateTime(session.lastSeenAt) }}</td>
            <td>{{ session.mfa ? 'oui' : 'non' }}</td>
            <td class="text-right">
              <button
                v-if="!session.current"
                class="btn-secondary"
                type="button"
                @click="revoke(session)"
              >
                Fermer
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
