<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AlertMessage from '../components/AlertMessage.vue';
import { describeError } from '../lib/api';
import { safeRedirect } from '../router';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const step = ref<'password' | 'mfa'>('password');
const email = ref('');
const password = ref('');
const code = ref('');
const error = ref<string | null>(null);
const pending = ref(false);

async function finish() {
  await router.replace(safeRedirect(route.query.redirect));
}

async function submitPassword() {
  pending.value = true;
  error.value = null;
  try {
    const next = await session.login(email.value, password.value);
    password.value = '';
    if (next === 'mfa') {
      step.value = 'mfa';
    } else {
      await finish();
    }
  } catch (caught) {
    error.value = describeError(caught, { 401: 'E-mail ou mot de passe incorrect.' });
  } finally {
    pending.value = false;
  }
}

async function submitCode() {
  pending.value = true;
  error.value = null;
  try {
    await session.verifyMfa(code.value);
    await finish();
  } catch (caught) {
    code.value = '';
    error.value = describeError(caught, { 401: 'Code invalide ou expiré.' });
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-shield-900 p-4">
    <div class="card w-full max-w-sm">
      <div class="mb-6 text-center">
        <p class="text-2xl font-semibold text-shield-700">ShieldGate</p>
        <h1 class="mt-1 text-sm text-slate-500">
          {{ step === 'password' ? 'Console d’administration' : 'Vérification en deux étapes' }}
        </h1>
      </div>

      <form v-if="step === 'password'" class="flex flex-col gap-4" @submit.prevent="submitPassword">
        <label class="flex flex-col gap-1.5">
          <span class="label">E-mail</span>
          <input v-model="email" class="input" type="email" autocomplete="username" required />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="label">Mot de passe</span>
          <input
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            required
          />
        </label>
        <AlertMessage v-if="error">{{ error }}</AlertMessage>
        <button class="btn-primary" type="submit" :disabled="pending">Se connecter</button>
      </form>

      <form v-else class="flex flex-col gap-4" @submit.prevent="submitCode">
        <p class="text-sm text-slate-600">
          Saisissez le code à 6 chiffres de votre application d’authentification.
        </p>
        <label class="flex flex-col gap-1.5">
          <span class="label">Code</span>
          <input
            v-model="code"
            class="input text-center font-mono text-lg tracking-widest"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
            required
          />
        </label>
        <AlertMessage v-if="error">{{ error }}</AlertMessage>
        <button class="btn-primary" type="submit" :disabled="pending">Vérifier</button>
      </form>
    </div>
  </div>
</template>
