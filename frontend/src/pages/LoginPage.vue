<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { Loader2 } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth';
import client from '@/api/client';
import { entraFailure, signInWithEntra, type EntraConfig } from '@/auth/msal';
import BrainGainLogo from '@/components/BrainGainLogo.vue';
import PasswordInput from '@/components/PasswordInput.vue';

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

// Microsoft Entra ID SSO — config is fetched at runtime; the button only shows when enabled.
const ssoEnabled = ref(false);
const ssoConfig = ref<EntraConfig | null>(null);
const ssoLoading = ref(false);
// While Microsoft sign-in is active the password form is the administrators' emergency door, folded
// away behind a link (SR-196); without SSO it is the only door and shown as before.
const showLocal = ref(false);

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

async function loginWithMicrosoft(): Promise<void> {
  if (!ssoConfig.value) return;
  error.value = '';
  ssoLoading.value = true;
  try {
    const idToken = await signInWithEntra(ssoConfig.value);
    await auth.loginWithEntra(idToken);
    router.push('/dashboard');
  } catch (e: unknown) {
    // A closed popup is not an error; Microsoft's own failures are named (AADSTS code) so people look
    // in the right place; our backend's refusals keep the server's message.
    const failure = entraFailure(e);
    if (axios.isAxiosError(e)) {
      error.value = e.response?.data?.error ?? t('login.errorMicrosoft');
    } else if (failure === 'cancelled') {
      // nothing to say
    } else if (failure) {
      error.value = t('login.errorMicrosoftDetail', { detail: failure });
    } else {
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
  <div
    class="flex min-h-screen items-center justify-center bg-gradient-to-br from-petrol-700 to-petrol-900 px-4"
  >
    <div class="card w-full max-w-md p-8">
      <div class="flex flex-col items-center text-center">
        <BrainGainLogo :size="64" />
        <h1 class="mt-4 text-2xl font-bold tracking-wide text-petrol-800">BrainGain</h1>
        <p class="font-mono text-xs text-ink-light">{{ t('common.tagline') }}</p>
      </div>

      <!-- With Microsoft sign-in active it is THE way in — one big button — and the password form is the
           administrators' emergency door, folded away. Without SSO the password form is the only door. -->
      <template v-if="ssoEnabled">
        <button
          type="button"
          class="btn-primary mt-8 w-full text-base"
          :disabled="ssoLoading"
          data-testid="sso-button"
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
        <p v-if="error && !showLocal" class="mt-3 font-mono text-xs text-rose-600">{{ error }}</p>
        <button
          type="button"
          class="mt-6 block w-full text-center font-mono text-xs text-ink-light underline-offset-2 hover:underline"
          data-testid="login-break-glass"
          @click="showLocal = !showLocal"
        >
          {{ t('login.breakGlass') }}
        </button>
      </template>

      <form
        v-if="!ssoEnabled || showLocal"
        class="mt-8 flex flex-col gap-4"
        :class="ssoEnabled ? 'border-t border-line pt-5' : ''"
        data-testid="login-form"
        @submit.prevent="submit"
      >
        <p v-if="ssoEnabled" class="font-mono text-xs text-ink-light">{{ t('login.localHint') }}</p>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('common.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" class="bg-input" required />
        </label>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('common.password') }}</span>
          <PasswordInput v-model="password" autocomplete="current-password" required />
        </label>

        <p v-if="error" class="font-mono text-xs text-rose-600">{{ error }}</p>

        <button type="submit" :class="ssoEnabled ? 'btn-ghost mt-2 w-full' : 'btn-primary mt-2 w-full'" :disabled="loading">
          <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
          {{ loading ? t('login.signingIn') : t('login.signIn') }}
        </button>
      </form>
    </div>
  </div>
</template>
