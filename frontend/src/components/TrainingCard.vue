<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Play } from 'lucide-vue-next';
import type { DueTraining } from '@/types';
import {
  dueLabel,
  dueClasses,
  formatDuration,
  isActionable,
  categoryTint,
  trainingReadiness,
} from '@/utils/display';
import { resolveLocalized } from '@/utils/locales';

const props = defineProps<{ item: DueTraining }>();
const emit = defineEmits<{ start: [id: string] }>();
const { t, locale } = useI18n();

const training = computed(() => props.item.training);
// Localized master data resolved to the UI language (English fallback) — no badge on cards.
const name = computed(() => resolveLocalized(training.value.name, locale.value).value);
const category = computed(() => resolveLocalized(training.value.category, locale.value).value);
const description = computed(() => resolveLocalized(training.value.description, locale.value).value);
const tint = computed(() => categoryTint(category.value));
const actionable = computed(() => isActionable(props.item.status));
// Without material to study the training can't be started; a missing test is fine — completion then
// happens through the audited materials confirmation on the session page.
const readiness = computed(() => trainingReadiness(training.value));
const label = computed(() => dueLabel(t, props.item.status, props.item.dueDate));

// One plain sentence instead of pill badges: "Yearly training, takes 1 h 30 min".
const meta = computed(() => {
  const cycle =
    training.value.cycleYears === 1
      ? t('trainingCard.metaYearly')
      : t('trainingCard.metaEvery', { years: training.value.cycleYears });
  return `${cycle}, ${t('trainingCard.metaDuration', { duration: formatDuration(training.value.durationMinutes) })}`;
});
</script>

<template>
  <div
    class="card relative flex h-full flex-col gap-2 bg-gradient-to-br to-white p-4 transition-transform hover:-translate-y-0.5 hover:shadow-lift"
    :class="tint"
  >
    <!-- The due status sits FLUSH in the card's top-left corner — the corner itself reads as red or
         green, the text just sits on it. Same colors/typography as the pill it replaces. -->
    <span
      class="absolute left-0 top-0 inline-flex h-6 items-center gap-1 rounded-br-lg rounded-tl-lg px-3 font-mono text-xs font-semibold leading-none"
      :class="dueClasses(item.status, item.dueDate)"
    >
      {{ label }}
    </span>

    <!-- Content version, flush in the opposite corner — bumped whenever an update is published. -->
    <span
      class="absolute right-0 top-0 inline-flex h-6 items-center rounded-bl-lg rounded-tr-lg bg-white/60 px-2.5 font-mono text-[11px] font-semibold leading-none text-ink-light"
      :title="t('trainings.versionTitle')"
    >
      {{ t('trainings.version', { version: training.version ?? 1 }) }}
    </span>

    <h3 class="mt-3 font-sans text-sm font-bold leading-snug text-ink">{{ name }}</h3>

    <!-- Category on its own line right below the title, per the plate structure. -->
    <p v-if="category" class="font-mono text-xs leading-relaxed text-ink-muted">
      {{ category }}
    </p>

    <p v-if="description" class="line-clamp-2 font-mono text-xs leading-relaxed text-ink-muted">
      {{ description }}
    </p>

    <!-- The editor's note on a pending update — why this training came back onto the list. -->
    <p v-if="item.pendingUpdate?.note" class="line-clamp-2 font-mono text-xs italic leading-relaxed text-blue-700">
      {{ item.pendingUpdate.note }}
    </p>

    <!-- Recurrence and duration as one small plain line instead of pill badges. -->
    <p class="font-mono text-[11px] text-ink-light">{{ meta }}</p>

    <div class="mt-auto flex justify-end pt-1">
      <button
        class="btn-primary btn-sm shrink-0"
        :class="{ '!bg-ink-light/60': !actionable && readiness.startable }"
        :disabled="!readiness.startable"
        :title="
          !readiness.startable
            ? t('trainingCard.unavailable')
            : actionable
              ? t('trainingCard.startSession')
              : t('trainingCard.notDueYet')
        "
        @click="emit('start', training.id)"
      >
        <Play class="h-3.5 w-3.5" /> {{ t('trainingCard.start') }}
      </button>
    </div>
  </div>
</template>
