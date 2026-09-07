<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import BrainGainLogo from './BrainGainLogo.vue';

// The About box, opened from the user menu (AppLayout). Every user can read the running app version
// here — on the admin-only Settings page it would have been invisible to trainees and trainers. The
// DATA version (the migration marker, see backend/src/services/dataVersion.ts) is diagnostics and
// comes from the admin-only /api/version, so that row is omitted — not shown empty — for everyone
// else. A failed request renders a dash; the dialog never breaks on it.
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const auth = useAuthStore();

const appVersion = ref<string | null>(null);
const dataVersion = ref<string | null>(null);
const closeBtn = ref<HTMLButtonElement | null>(null);

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

onMounted(async () => {
  document.addEventListener('keydown', onKey);
  closeBtn.value?.focus();
  try {
    const { data } = await client.get<{ ok: boolean; version: string }>('/health');
    appVersion.value = data.version;
  } catch {
    appVersion.value = '—';
  }
  if (auth.user?.isAdmin) {
    try {
      const { data } = await client.get<{ app: string; data: string | null }>('/version');
      dataVersion.value = data.data ?? '—';
    } catch {
      dataVersion.value = '—';
    }
  }
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <!-- Deliberately no <Transition>: interrupted transitions tore down freshly-mounted dialogs
       elsewhere (see TrainingsPage). Same overlay + card idiom as the session confirmations. -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
    data-testid="about-dialog"
    @click.self="emit('close')"
  >
    <div class="card w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div class="flex items-start justify-between gap-3">
        <h2 id="about-title" class="font-sans text-lg font-bold text-ink">{{ t('about.title') }}</h2>
        <button
          ref="closeBtn"
          class="shrink-0 rounded-md text-ink-light transition hover:text-ink"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          data-testid="about-close"
          @click="emit('close')"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <div class="mt-5 flex flex-col items-center gap-3 text-center">
        <BrainGainLogo :size="64" />
        <div class="text-sm font-bold uppercase tracking-[0.25em] text-ink">{{ t('common.appName') }}</div>
      </div>

      <dl class="mt-6 divide-y divide-line rounded-lg border border-line">
        <div class="flex items-center justify-between gap-4 px-4 py-2.5">
          <dt class="text-sm text-ink-muted">{{ t('about.version') }}</dt>
          <dd class="font-mono text-sm font-semibold text-ink" data-testid="about-app-version">{{ appVersion ?? '…' }}</dd>
        </div>
        <!-- Admin only: the shape the stored data is in. Equal to the app version on a fully
             migrated installation; anything else is the first thing support wants to know. -->
        <div v-if="auth.user?.isAdmin" class="flex items-center justify-between gap-4 px-4 py-2.5">
          <dt class="text-sm text-ink-muted">
            {{ t('about.dataVersion') }}
            <span class="block font-mono text-[11px] text-ink-light">{{ t('about.dataVersionHint') }}</span>
          </dt>
          <dd class="font-mono text-sm font-semibold text-ink" data-testid="about-data-version">{{ dataVersion ?? '…' }}</dd>
        </div>
      </dl>

      <div class="mt-5 flex justify-end">
        <button class="btn-ghost btn-sm" @click="emit('close')">{{ t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>
