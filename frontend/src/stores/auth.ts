import { defineStore } from 'pinia';
import { ref } from 'vue';
import client from '@/api/client';
import type { SafeUser } from '@/types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SafeUser | null>(null);
  const token = ref<string | null>(localStorage.getItem('token'));

  async function login(email: string, password: string): Promise<void> {
    const { data } = await client.post<{ token: string; user: SafeUser }>('/auth/login', {
      email,
      password,
    });
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
    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('token', data.token);
  }

  async function fetchMe(): Promise<void> {
    if (!token.value) return;
    const { data } = await client.get<SafeUser>('/auth/me');
    user.value = data;
  }

  function logout(): void {
    user.value = null;
    token.value = null;
    localStorage.removeItem('token');
  }

  return { user, token, login, loginWithEntra, fetchMe, logout };
});
