<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { Loader2 } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth';
import client from '@/api/client';
import BrainGainLogo from '@/components/BrainGainLogo.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const token = String(route.query.token ?? '');

const checking = ref(true); // validating the link on mount
const accountEmail = ref('');
const linkValid = ref(false);

const password = ref('');
const confirm = ref('');
const submitting = ref(false);
const error = ref('');

onMounted(async () => {
  if (!token) {
    checking.value = false;
    return;
  }
  try {
    const { data } = await client.get<{ email: string; name: string }>(
      `/auth/activate/${encodeURIComponent(token)}`,
    );
    accountEmail.value = data.email;
    linkValid.value = true;
  } catch {
    linkValid.value = false;
  } finally {
    checking.value = false;
  }
});

async function submit(): Promise<void> {
  error.value = '';
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters';
    return;
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match';
    return;
  }
  submitting.value = true;
  try {
    await auth.activate(token, password.value);
    router.push('/dashboard');
  } catch (e: unknown) {
    error.value = axios.isAxiosError(e)
      ? (e.response?.data?.error ?? 'Could not activate your account')
      : 'Could not activate your account';
  } finally {
    submitting.value = false;
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
          Activate your account
        </h1>
        <p class="font-mono text-xs text-ink-light">Choose a password to finish signing up.</p>
      </div>

      <div v-if="checking" class="mt-8 flex justify-center text-ink-light">
        <Loader2 class="h-5 w-5 animate-spin" />
      </div>

      <div v-else-if="!linkValid" class="mt-8 text-center">
        <p class="font-mono text-sm text-rose-600">
          This activation link is invalid or has already been used.
        </p>
        <RouterLink to="/login" class="btn-ghost mt-4 inline-flex">Back to sign in</RouterLink>
      </div>

      <form v-else class="mt-8 flex flex-col gap-4" @submit.prevent="submit">
        <label class="flex flex-col gap-1">
          <span class="font-sans text-xs font-semibold text-ink-muted">Email</span>
          <input :value="accountEmail" type="email" class="bg-input" disabled />
        </label>
        <label class="flex flex-col gap-1">
          <span class="font-sans text-xs font-semibold text-ink-muted">New password</span>
          <input
            v-model="password"
            type="password"
            autocomplete="new-password"
            class="bg-input"
            required
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="font-sans text-xs font-semibold text-ink-muted">Confirm password</span>
          <input
            v-model="confirm"
            type="password"
            autocomplete="new-password"
            class="bg-input"
            required
          />
        </label>

        <p v-if="error" class="font-mono text-xs text-rose-600">{{ error }}</p>

        <button type="submit" class="btn-primary mt-2 w-full" :disabled="submitting">
          <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
          {{ submitting ? 'Activating…' : 'Set password & sign in' }}
        </button>
      </form>
    </div>
  </div>
</template>
