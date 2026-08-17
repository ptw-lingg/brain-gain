<script setup lang="ts">
// The explicit "publish update" step after a training's materials/quiz changed (opened by
// TrainingsPage after such a save, or manually to manage pending updates). The editor decides
// per update whether prior completers must fully retake or just review + confirm, sets the
// deadline, and reviews the notification email before it goes out. Skipping is always fine —
// a typo fix needs no update. Publishing creates the next training version.
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Loader2, Send, Trash2, X } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { PublishUpdateResponse, Settings, Training, TrainingUpdate } from '@/types';
import { formatDate } from '@/utils/display';
import { resolveLocalized } from '@/utils/locales';

const props = defineProps<{ training: Training }>();
// `changed` = something was published or cancelled — the parent must reload its training list.
const emit = defineEmits<{ close: []; changed: [] }>();

const { t, locale } = useI18n();
const toast = useToastStore();

const name = computed(() => resolveLocalized(props.training.name, locale.value).value);
const nextVersion = computed(() => (props.training.version ?? 1) + 1);
const pending = computed<TrainingUpdate[]>(() => props.training.updates ?? []);

function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}
const todayStr = new Date().toISOString().slice(0, 10);

const mode = ref<'retake' | 'confirm'>('retake');
const deadline = ref(defaultDeadline());
const note = ref('');
const publishing = ref(false);
const cancellingId = ref<string | null>(null);

// Company name for the mail templates — same source as the TraineesPage reminders.
const company = ref('');
onMounted(async () => {
  try {
    company.value = (await client.get<Settings>('/settings')).data.companyName ?? '';
  } catch {
    company.value = '';
  }
});

const deadlineLabel = computed(() =>
  deadline.value ? formatDate(`${deadline.value}T23:59:59.999Z`) : '',
);

// Email subject/text prefilled from i18n and regenerated while the editor tweaks mode/deadline/
// note — until they edit the email itself; from then on their wording wins.
const emailSubject = ref('');
const emailText = ref('');
const subjectDirty = ref(false);
const textDirty = ref(false);
watch(
  [mode, deadline, note, company, name],
  () => {
    const params = {
      training: name.value,
      version: nextVersion.value,
      date: deadlineLabel.value,
      note: note.value.trim(),
      company: company.value || t('common.appName'),
    };
    if (!subjectDirty.value) emailSubject.value = t('trainings.publish.mailSubject', params);
    if (!textDirty.value) {
      emailText.value =
        mode.value === 'retake'
          ? t('trainings.publish.mailBodyRetake', params)
          : t('trainings.publish.mailBodyConfirm', params);
    }
  },
  { immediate: true },
);

async function publish(): Promise<void> {
  publishing.value = true;
  try {
    const { data } = await client.post<PublishUpdateResponse>(
      `/trainings/${props.training.id}/publish-update`,
      {
        mode: mode.value,
        deadline: deadline.value,
        note: note.value.trim() || undefined,
        emailSubject: emailSubject.value.trim(),
        emailText: emailText.value.trim(),
      },
    );
    // The publish itself succeeded either way; the toast tells whether the email went out.
    if ('sent' in data.email) {
      toast.success(t('trainings.publish.toasts.published', { version: data.version, count: data.email.sent }, data.email.sent));
    } else {
      toast.success(t('trainings.publish.toasts.publishedNoMail', { version: data.version }));
    }
    emit('changed');
    emit('close');
  } catch {
    toast.error(t('trainings.publish.toasts.publishError'));
  } finally {
    publishing.value = false;
  }
}

// Withdraw a published update: the obligation disappears for everyone; the version stays.
async function cancelUpdate(u: TrainingUpdate): Promise<void> {
  cancellingId.value = u.id;
  try {
    await client.delete(`/trainings/${props.training.id}/updates/${u.id}`);
    toast.success(t('trainings.publish.toasts.cancelled'));
    emit('changed');
  } catch {
    toast.error(t('trainings.publish.toasts.cancelError'));
  } finally {
    cancellingId.value = null;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-ink/40" @click="emit('close')" />
    <div
      class="relative z-10 flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-lift"
      role="dialog"
      aria-modal="true"
      :aria-label="t('trainings.publish.title')"
      data-testid="publish-update-dialog"
    >
      <div class="flex items-center justify-between border-b border-line px-5 py-3">
        <div class="min-w-0">
          <h2 class="truncate font-sans text-base font-bold text-ink">{{ t('trainings.publish.title') }}</h2>
          <p class="font-mono text-[11px] text-ink-light">
            {{ name }} · {{ t('trainings.publish.nextVersion', { version: nextVersion }) }}
          </p>
        </div>
        <button class="ml-3 shrink-0 text-ink-light hover:text-ink" :title="t('common.close')" :aria-label="t('common.close')" @click="emit('close')">
          <X class="h-5 w-5" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-5">
        <p class="font-mono text-xs text-ink-muted">{{ t('trainings.publish.intro') }}</p>

        <!-- What must trainees do? -->
        <fieldset class="mt-4">
          <legend class="form-label">{{ t('trainings.publish.modeLabel') }}</legend>
          <label class="check-card mt-2" :class="mode === 'retake' ? 'border-accent bg-accent-light/30' : ''">
            <input v-model="mode" type="radio" value="retake" class="mt-0.5 accent-accent" />
            <span>
              <span class="block text-sm font-semibold text-ink">{{ t('trainings.publish.modeRetake') }}</span>
              <span class="block font-mono text-[11px] text-ink-light">{{ t('trainings.publish.modeRetakeHint') }}</span>
            </span>
          </label>
          <label class="check-card mt-2" :class="mode === 'confirm' ? 'border-accent bg-accent-light/30' : ''">
            <input v-model="mode" type="radio" value="confirm" class="mt-0.5 accent-accent" />
            <span>
              <span class="block text-sm font-semibold text-ink">{{ t('trainings.publish.modeConfirm') }}</span>
              <span class="block font-mono text-[11px] text-ink-light">{{ t('trainings.publish.modeConfirmHint') }}</span>
            </span>
          </label>
        </fieldset>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="block">
            <span class="form-label">{{ t('trainings.publish.deadline') }}</span>
            <input v-model="deadline" type="date" :min="todayStr" class="bg-input mt-1" data-testid="publish-deadline" />
          </label>
        </div>

        <label class="mt-4 block">
          <span class="form-label">{{ t('trainings.publish.note') }}</span>
          <textarea v-model="note" rows="2" class="bg-input mt-1" :placeholder="t('trainings.publish.notePlaceholder')" />
        </label>

        <!-- Notification email, prefilled — editable until sent. -->
        <div class="mt-4 rounded-lg border border-line bg-pastel-slate/20 p-4">
          <p class="form-label">{{ t('trainings.publish.emailPreview') }}</p>
          <input
            v-model="emailSubject"
            type="text"
            class="bg-input mt-2"
            :aria-label="t('trainings.publish.emailSubject')"
            @input="subjectDirty = true"
          />
          <textarea
            v-model="emailText"
            rows="6"
            class="bg-input mt-2 font-mono text-xs"
            :aria-label="t('trainings.publish.emailBody')"
            @input="textDirty = true"
          />
        </div>

        <!-- Already-published updates: cancellable; the version never rolls back. -->
        <div v-if="pending.length" class="mt-5">
          <p class="form-label">{{ t('trainings.publish.pendingTitle') }}</p>
          <div
            v-for="u in pending"
            :key="u.id"
            class="mt-2 flex items-center gap-3 rounded-lg border border-line px-3 py-2"
          >
            <span class="pill shrink-0 bg-pastel-blue/60 text-blue-700">v{{ u.version }}</span>
            <span class="min-w-0 flex-1 font-mono text-xs text-ink-muted">
              {{ u.mode === 'retake' ? t('trainings.publish.modeRetake') : t('trainings.publish.modeConfirm') }}
              · {{ t('trainings.publish.pendingBy', { date: formatDate(u.deadline) }) }}
            </span>
            <button
              class="btn-ghost btn-sm shrink-0 !text-rose-600"
              :disabled="cancellingId === u.id"
              @click="cancelUpdate(u)"
            >
              <Loader2 v-if="cancellingId === u.id" class="h-3.5 w-3.5 animate-spin" />
              <Trash2 v-else class="h-3.5 w-3.5" /> {{ t('trainings.publish.cancelUpdate') }}
            </button>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 border-t border-line px-5 py-3">
        <button class="btn-primary" :disabled="publishing || !deadline" data-testid="publish-update-ok" @click="publish">
          <Loader2 v-if="publishing" class="h-4 w-4 animate-spin" />
          <Send v-else class="h-4 w-4" /> {{ t('trainings.publish.publish') }}
        </button>
        <button class="btn-ghost" :disabled="publishing" data-testid="publish-update-skip" @click="emit('close')">
          {{ t('trainings.publish.skip') }}
        </button>
      </div>
    </div>
  </div>
</template>
