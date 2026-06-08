import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import client from '@/api/client';
import type { SafeUser } from '@/types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SafeUser | null>(null);
  const token = ref<string | null>(localStorage.getItem('token'));
  // Present only while an admin is impersonating: the admin's own token, parked so we can
  // restore it on "stop". Its presence is what `isImpersonating` keys off — survives a refresh.
  const impersonatorToken = ref<string | null>(localStorage.getItem('impersonatorToken'));
  const isImpersonating = computed(() => impersonatorToken.value !== null);

  // A fresh sign-in always starts a clean (non-impersonating) session.
  function clearImpersonation(): void {
    impersonatorToken.value = null;
    localStorage.removeItem('impersonatorToken');
  }

  async function login(email: string, password: string): Promise<void> {
    const { data } = await client.post<{ token: string; user: SafeUser }>('/auth/login', {
      email,
      password,
    });
    clearImpersonation();
    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('token', data.token);
  }

  // Exchange a Microsoft Entra ID token (from MSAL) for our own app JWT. Stores the session
  // identically to password login, so everything downstream (interceptor, guard, /me) is unchanged.
  async function loginWithEntra(idToken: string): Promise<void> {
    const { data } = await client.post<{ token: string; user: SafeUser }>('/auth/sso/entra', {
      idToken,
    });
    clearImpersonation();
    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('token', data.token);
  }

  // Activate a pending (imported) account: set the chosen password via the one-time token and sign in.
  // Stores the session exactly like login, so everything downstream is unchanged.
  async function activate(activationToken: string, password: string): Promise<void> {
    const { data } = await client.post<{ token: string; user: SafeUser }>('/auth/activate', {
      token: activationToken,
      password,
    });
    clearImpersonation();
    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('token', data.token);
  }

  async function fetchMe(): Promise<void> {
    if (!token.value) return;
    const { data } = await client.get<SafeUser>('/auth/me');
    user.value = data;
  }

  // Admin → "view as" a user. The admin token (currently active) is parked, and the
  // server-issued impersonation token takes over, so the whole app renders as the target user.
  async function startImpersonation(userId: string): Promise<void> {
    const { data } = await client.post<{ token: string; user: SafeUser }>(
      `/auth/impersonate/${userId}`,
    );
    if (token.value) {
      impersonatorToken.value = token.value;
      localStorage.setItem('impersonatorToken', token.value);
    }
    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('token', data.token);
  }

  // End a "view as" session: restore the parked admin token and reload the admin's own profile.
  async function stopImpersonation(): Promise<void> {
    if (!impersonatorToken.value) return;
    token.value = impersonatorToken.value;
    localStorage.setItem('token', impersonatorToken.value);
    impersonatorToken.value = null;
    localStorage.removeItem('impersonatorToken');
    await fetchMe();
  }

  function logout(): void {
    user.value = null;
    token.value = null;
    impersonatorToken.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('impersonatorToken');
  }

  return {
    user,
    token,
    isImpersonating,
    login,
    loginWithEntra,
    activate,
    fetchMe,
    startImpersonation,
    stopImpersonation,
    logout,
  };
});
