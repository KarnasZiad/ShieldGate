import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, ApiError } from '../lib/api';
import { hasPermission } from '../lib/permissions';
import type { AuthenticatedSession, LoginResponse, SessionUser } from '../lib/types';

export type SessionStatus = 'unknown' | 'anonymous' | 'authenticated';

/** The signed-in administrator. The CSRF token lives in memory only, like the cookie is httpOnly. */
export const useSessionStore = defineStore('session', () => {
  const status = ref<SessionStatus>('unknown');
  const user = ref<SessionUser | null>(null);
  const csrfToken = ref<string | null>(null);
  const mfa = ref(false);
  const challengeId = ref<string | null>(null);

  const authenticated = computed(() => status.value === 'authenticated');

  function apply(session: AuthenticatedSession): void {
    status.value = 'authenticated';
    user.value = session.user;
    csrfToken.value = session.csrfToken;
    mfa.value = session.mfa;
    challengeId.value = null;
  }

  function reset(): void {
    status.value = 'anonymous';
    user.value = null;
    csrfToken.value = null;
    mfa.value = false;
    challengeId.value = null;
  }

  /** Restores the session from the cookie after a page load. */
  async function restore(): Promise<void> {
    try {
      apply(await api().get<AuthenticatedSession>('/v1/auth/session'));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      reset();
    }
  }

  /** First step. Returns "mfa" when a TOTP code is expected next. */
  async function login(email: string, password: string): Promise<'done' | 'mfa'> {
    const response = await api().post<LoginResponse>('/v1/auth/login', { email, password });
    if (response.status === 'mfa_required') {
      challengeId.value = response.challengeId;
      return 'mfa';
    }
    apply(response);
    return 'done';
  }

  async function verifyMfa(code: string): Promise<void> {
    if (!challengeId.value) throw new Error('No sign-in in progress');
    const response = await api().post<LoginResponse>('/v1/auth/mfa', {
      challengeId: challengeId.value,
      code,
    });
    if (response.status === 'authenticated') apply(response);
  }

  async function logout(): Promise<void> {
    try {
      await api().post('/v1/auth/logout');
    } finally {
      reset();
    }
  }

  function can(permission: string): boolean {
    return hasPermission(user.value?.permissions ?? [], permission);
  }

  return {
    status,
    user,
    csrfToken,
    mfa,
    challengeId,
    authenticated,
    restore,
    login,
    verifyMfa,
    logout,
    reset,
    can,
  };
});
