<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { FileText, Play } from 'lucide-vue-next';
import type { DueTraining } from '@/types';
import {
  dueLabel,
  dueCornerClasses,
  formatDuration,
  isActionable,
  categoryTint,
  trainingReadiness,
} from '@/utils/display';
import { resolveLocalized } from '@/utils/locales';
import { usePreviewImage } from '@/composables/usePreviewImage';

// `lastOpened` marks the card whose session was started last, so the user sees where they were
// when they come back from the training.
const props = defineProps<{ item: DueTraining; lastOpened?: boolean }>();
const emit = defineEmits<{ start: [id: string] }>();
const { t, locale } = useI18n();

const training = computed(() => props.item.training);
// Localized master data resolved to the UI language (English fallback) — no badge on cards.
const name = computed(() => resolveLocalized(training.value.name, locale.value).value);
const category = computed(() => resolveLocalized(training.value.category, locale.value).value);
const description = computed(() => resolveLocalized(training.value.description, locale.value).value);
const tint = computed(() => categoryTint(category.value));
const actionable = computed(() => isActionable(props.item.status));
// The cover: the trainer's preview image, fetched with the Authorization header (a plain <img src>
// cannot send it). Until it arrives — or when the training has none — the cover shows the category
// tint with a neutral document glyph, so every card keeps the same shape.
const imageUrl = usePreviewImage(computed(() => training.value.previewImage?.id ?? null));
// Without material to study the training can't be started; a missing test is fine — completion then
// happens through the audited materials confirmation on the session page.
const readiness = computed(() => trainingReadiness(training.value));
// Version 0 = the trainer has not published the first version yet: the card is visible (the
// learner knows it is coming) but shows a neutral "in preparation" state and cannot be started.
const unpublished = computed(() => (training.value.version ?? 1) === 0);
const label = computed(() =>
  unpublished.value ? t('trainingCard.inPreparation') : dueLabel(t, props.item.status, props.item.dueDate),
);

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
    class="card relative flex h-full flex-col overflow-hidden transition-transform hover:-translate-y-0.5 hover:shadow-lift"
    :class="lastOpened ? 'ring-1 ring-accent' : ''"
    :data-selected="lastOpened ? 'true' : undefined"
  >
    <!-- Cover band: the preview image, or the category tint with a document glyph when there is
         none. The due status sits FLUSH in the top-left corner OF THE COVER — opaque, so it stays
         readable on a dark photo. Same typography as the pill it replaces. -->
    <div class="relative h-[124px] shrink-0 bg-pastel-sky" data-testid="training-card-cover">
      <img
        v-if="imageUrl"
        :src="imageUrl"
        alt=""
        class="h-full w-full object-cover"
        data-testid="training-card-image"
      />
      <div
        v-else
        class="flex h-full w-full items-center justify-center bg-gradient-to-br to-pastel-sky"
        :class="tint"
      >
        <FileText class="h-8 w-8 text-ink-light" aria-hidden="true" />
      </div>
      <span
        class="absolute left-0 top-0 inline-flex h-6 items-center gap-1 rounded-br-lg rounded-tl-lg px-3 font-mono text-xs font-semibold leading-none"
        :class="unpublished ? 'bg-pastel-slate text-ink-muted' : dueCornerClasses(item.status, item.dueDate)"
      >
        {{ label }}
      </span>
    </div>

    <div class="flex flex-1 flex-col gap-2 bg-gradient-to-br to-white px-4 pb-4 pt-3" :class="tint">
      <h3 class="font-sans text-sm font-bold leading-snug text-ink">{{ name }}</h3>

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
          :class="{ '!bg-ink-light/60': !actionable && readiness.startable && !unpublished }"
          :disabled="!readiness.startable || unpublished"
          :title="
            unpublished
              ? t('trainingCard.inPreparation')
              : !readiness.startable
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
  </div>
</template>
