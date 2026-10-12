<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { Loader2, X } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import PasswordInput from './PasswordInput.vue';

// Self-service password change, opened from the user menu (AppLayout) for accounts that sign in with
// a local password (SR-195). The user proves the current password; no email is involved. A forgotten
// password is reset by an administrator in the user editor.
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const toast = useToastStore();

const current = ref('');
const next = ref('');
const confirm = ref('');
const error = ref('');
const saving = ref(false);

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));

async function submit(): Promise<void> {
  error.value = '';
  if (next.value.length < 8) {
    error.value = t('changePassword.errorShort');
    return;
  }
  if (next.value !== confirm.value) {
    error.value = t('changePassword.errorMismatch');
    return;
  }
  if (next.value === current.value) {
    error.value = t('changePassword.errorSame');
    return;
  }
  saving.value = true;
  try {
    await client.put('/auth/password', { currentPassword: current.value, newPassword: next.value });
    toast.success(t('changePassword.success'));
    emit('close');
  } catch (e: unknown) {
    const data = axios.isAxiosError(e) ? e.response?.data : undefined;
    error.value =
      data?.code === 'wrong-password' ? t('changePassword.errorWrongCurrent') : (data?.error ?? t('changePassword.errorGeneric'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <!-- Same overlay + card idiom as the About box; no <Transition> (see AboutDialog). -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
    data-testid="change-password-dialog"
    @click.self="emit('close')"
  >
    <div class="card w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <div class="flex items-start justify-between gap-3">
        <h2 id="change-password-title" class="font-sans text-lg font-bold text-ink">{{ t('changePassword.title') }}</h2>
        <button class="shrink-0 rounded-md text-ink-light transition hover:text-ink" :aria-label="t('common.close')" @click="emit('close')">
          <X class="h-5 w-5" />
        </button>
      </div>

      <form class="mt-4 flex flex-col gap-4" @submit.prevent="submit">
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('changePassword.current') }}</span>
          <PasswordInput v-model="current" autocomplete="current-password" required />
        </label>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('changePassword.new') }}</span>
          <PasswordInput v-model="next" autocomplete="new-password" required />
        </label>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('changePassword.confirm') }}</span>
          <PasswordInput v-model="confirm" autocomplete="new-password" required />
        </label>

        <p v-if="error" class="font-mono text-xs text-rose-600" data-testid="change-password-error">{{ error }}</p>

        <div class="flex justify-end gap-2">
          <button type="button" class="btn-ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn-primary" :disabled="saving" data-testid="change-password-submit">
            <Loader2 v-if="saving" class="h-4 w-4 animate-spin" />
            {{ t('changePassword.submit') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
