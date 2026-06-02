<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { Loader2 } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth';
import BrainGainLogo from '@/components/BrainGainLogo.vue';

const auth = useAuthStore();
const router = useRouter();

const email = ref('admin@braingain.app');
const password = ref('admin123');
const loading = ref(false);
const error = ref('');

const demos = [
  { label: 'Admin', email: 'admin@braingain.app', password: 'admin123' },
  { label: 'Trainer', email: 'trainer@braingain.app', password: 'trainer123' },
  { label: 'Member', email: 'user@braingain.app', password: 'user123' },
];

function fill(d: { email: string; password: string }): void {
  email.value = d.email;
  password.value = d.password;
}

async function submit(): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(email.value, password.value);
    router.push('/dashboard');
  } catch (e: unknown) {
    error.value = axios.isAxiosError(e)
      ? (e.response?.data?.error ?? 'Login failed')
      : 'Login failed';
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
        <p class="font-mono text-xs text-ink-light">Grow what you know.</p>
      </div>

      <form class="mt-8 flex flex-col gap-4" @submit.prevent="submit">
        <label class="flex flex-col gap-1">
          <span class="font-sans text-xs font-semibold text-ink-muted">Email</span>
          <input v-model="email" type="email" autocomplete="username" class="bg-input" required />
        </label>
        <label class="flex flex-col gap-1">
          <span class="font-sans text-xs font-semibold text-ink-muted">Password</span>
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
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <div class="mt-6 border-t border-line pt-4">
        <p class="text-center font-mono text-[10px] uppercase tracking-wider text-ink-light">
          Demo accounts
        </p>
        <div class="mt-2 flex justify-center gap-2">
          <button
            v-for="d in demos"
            :key="d.label"
            class="btn-ghost !px-3 !py-1 !text-xs"
            @click="fill(d)"
          >
            {{ d.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
