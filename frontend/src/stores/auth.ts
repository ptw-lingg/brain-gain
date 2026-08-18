import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import client from '@/api/client';
import { setLocale, SUPPORTED_LOCALES, type LocaleCode } from '@/i18n';
import type { SafeUser, UiPrefKey } from '@/types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SafeUser | null>(null);
  const token = ref<string | null>(localStorage.getItem('token'));
  // Present only while an admin is impersonating: the admin's own token, parked so we can
  // restore it on "stop". Its presence is what `isImpersonating` keys off — survives a refresh.
  const impersonatorToken = ref<string | null>(localStorage.getItem('impersonatorToken'));
  const isImpersonating = computed(() => impersonatorToken.value !== null);

  const isUiLocale = (code: unknown): code is LocaleCode =>
    SUPPORTED_LOCALES.some((l) => l.code === code);

  // The single place a server identity becomes the session user. Applies the persisted profile
  // locale to the UI — but NEVER during impersonation, or the target user's language would switch
  // the admin's UI mid-session (this also covers fetchMe on a mid-impersonation page refresh).
  function applyUser(u: SafeUser): void {
    user.value = u;
    if (!isImpersonating.value && isUiLocale(u.locale)) setLocale(u.locale);
  }

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
    localStorage.setItem('token', data.token);
    applyUser(data.user);
  }

  // Exchange a Microsoft Entra ID token (from MSAL) for our own app JWT. Stores the session
  // identically to password login, so everything downstream (interceptor, guard, /me) is unchanged.
  async function loginWithEntra(idToken: string): Promise<void> {
    const { data } = await client.post<{ token: string; user: SafeUser }>('/auth/sso/entra', {
      idToken,
    });
    clearImpersonation();
    token.value = data.token;
    localStorage.setItem('token', data.token);
    applyUser(data.user);
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
    localStorage.setItem('token', data.token);
    applyUser(data.user);
  }

  async function fetchMe(): Promise<void> {
    if (!token.value) return;
    const { data } = await client.get<SafeUser>('/auth/me');
    applyUser(data);
  }

  // The user picked a language: switch the UI immediately (offline-safe — localStorage keeps the
  // choice), then persist it to the profile so it follows them to any browser. Never persisted
  // while impersonating: the active token belongs to the TARGET user, so a PUT would silently
  // overwrite the impersonated user's profile (the server refuses it with 403 as well).
  async function saveLocale(code: LocaleCode): Promise<void> {
    setLocale(code);
    if (isImpersonating.value) return;
    try {
      const { data } = await client.put<SafeUser>('/auth/me', { locale: code });
      user.value = data;
    } catch {
      // The UI language is already switched; the profile write can catch up next time.
    }
  }

  // The user flipped a persisted UI preference (a "show only due" filter): the view has already
  // switched locally, so the profile write only has to catch up. Never persisted while
  // impersonating — the active token belongs to the TARGET user (the server refuses it with 403).
  async function savePref(key: UiPrefKey, value: boolean): Promise<void> {
    if (isImpersonating.value) return;
    try {
      const { data } = await client.put<SafeUser>('/auth/me', { prefs: { [key]: value } });
      user.value = data;
    } catch {
      // The view already reflects the toggle; the profile write can catch up next time.
    }
  }

  // Admin → "view as" a user. The admin token (currently active) is parked, and the
  // server-issued impersonation token takes over, so the whole app renders as the target user.
  // Deliberately NOT applyUser: the target's locale must not switch the admin's UI language.
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

  // End a "view as" session: restore the parked admin token and reload the admin's own profile
  // (fetchMe → applyUser also restores the admin's own UI language).
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
    saveLocale,
    savePref,
    startImpersonation,
    stopImpersonation,
    logout,
  };
});
