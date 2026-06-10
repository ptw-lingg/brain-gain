<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { Loader2 } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth';
import client from '@/api/client';
import { signInWithEntra, type EntraConfig } from '@/auth/msal';
import BrainGainLogo from '@/components/BrainGainLogo.vue';

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

const email = ref('admin@braingain.app');
const password = ref('admin123');
const loading = ref(false);
const error = ref('');

// Microsoft Entra ID SSO — config is fetched at runtime; the button only shows when enabled.
const ssoEnabled = ref(false);
const ssoConfig = ref<EntraConfig | null>(null);
const ssoLoading = ref(false);

onMounted(async () => {
  try {
    const { data } = await client.get<{ enabled: boolean; clientId?: string; authority?: string }>(
      '/auth/sso/config',
    );
    if (data.enabled && data.clientId && data.authority) {
      ssoConfig.value = { clientId: data.clientId, authority: data.authority };
      ssoEnabled.value = true;
    }
  } catch {
    // No SSO config available → leave the button hidden.
  }
});

/** True when MSAL reports the user closed/cancelled the popup — not a real error. */
function isUserCancellation(e: unknown): boolean {
  const code = (e as { errorCode?: unknown })?.errorCode;
  return (
    typeof code === 'string' &&
    ['user_cancelled', 'popup_window_error', 'interaction_in_progress'].includes(code)
  );
}

async function loginWithMicrosoft(): Promise<void> {
  if (!ssoConfig.value) return;
  error.value = '';
  ssoLoading.value = true;
  try {
    const idToken = await signInWithEntra(ssoConfig.value);
    await auth.loginWithEntra(idToken);
    router.push('/dashboard');
  } catch (e: unknown) {
    if (axios.isAxiosError(e)) {
      error.value = e.response?.data?.error ?? t('login.errorMicrosoft');
    } else if (!isUserCancellation(e)) {
      error.value = t('login.errorMicrosoft');
    }
  } finally {
    ssoLoading.value = false;
  }
}

async function submit(): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(email.value, password.value);
    router.push('/dashboard');
  } catch (e: unknown) {
    error.value = axios.isAxiosError(e)
      ? (e.response?.data?.error ?? t('login.errorLogin'))
      : t('login.errorLogin');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-bg-primary px-4">
    <div class="card w-full max-w-md p-8" style="border-radius: 24px">
      <div class="flex flex-col items-center text-center">
        <BrainGainLogo :size="64" />
        <h1
          class="mt-4 bg-gradient-to-r from-accent to-sky-400 bg-clip-text text-2xl font-bold text-transparent"
        >
          BrainGain
        </h1>
        <p class="font-mono text-xs text-ink-light">{{ t('common.tagline') }}</p>
      </div>

      <form class="mt-8 flex flex-col gap-4" @submit.prevent="submit">
        <label class="flex flex-col gap-1">
          <span class="font-sans text-xs font-semibold text-ink-muted">{{ t('common.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" class="bg-input" required />
        </label>
        <label class="flex flex-col gap-1">
          <span class="font-sans text-xs font-semibold text-ink-muted">{{ t('common.password') }}</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="bg-input"
            required
          />
        </label>

        <p v-if="error" class="font-mono text-xs text-rose-600">{{ error }}</p>

        <button type="submit" class="btn-primary mt-2 w-full" :disabled="loading">
          <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
          {{ loading ? t('login.signingIn') : t('login.signIn') }}
        </button>
      </form>

      <template v-if="ssoEnabled">
        <div class="my-5 flex items-center gap-3">
          <div class="h-px flex-1 bg-line" />
          <span class="font-mono text-[10px] uppercase tracking-wider text-ink-light">{{ t('login.or') }}</span>
          <div class="h-px flex-1 bg-line" />
        </div>
        <button
          type="button"
          class="btn-ghost w-full"
          :disabled="ssoLoading"
          @click="loginWithMicrosoft"
        >
          <Loader2 v-if="ssoLoading" class="h-4 w-4 animate-spin" />
          <svg v-else viewBox="0 0 21 21" class="h-4 w-4" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          {{ ssoLoading ? t('login.signingIn') : t('login.signInWithMicrosoft') }}
        </button>
      </template>
    </div>
  </div>
</template>
