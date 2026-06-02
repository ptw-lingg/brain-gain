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

  return { user, token, login, fetchMe, logout };
});
