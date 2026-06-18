<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle, Clock, Play } from 'lucide-vue-next';
import type { DueTraining } from '@/types';
import {
  dueLabel,
  dueClasses,
  isActionable,
  categoryTint,
  cycleLabel,
  trainingReadiness,
} from '@/utils/display';

const props = defineProps<{ item: DueTraining }>();
const emit = defineEmits<{ start: [id: string] }>();
const { t } = useI18n();

const training = computed(() => props.item.training);
const tint = computed(() => categoryTint(training.value.category));
const actionable = computed(() => isActionable(props.item.status));
// Without material to study or questions to be tested on, the training can't be started.
const readiness = computed(() => trainingReadiness(training.value));
const label = computed(() => dueLabel(t, props.item.status, props.item.dueDate));
</script>

<template>
  <div
    class="card flex h-full flex-col gap-2 bg-gradient-to-br to-white p-4 transition-transform hover:-translate-y-0.5 hover:shadow-lift"
    :class="tint"
  >
    <h3 class="font-sans text-sm font-bold leading-snug text-ink">{{ training.name }}</h3>

    <p class="line-clamp-2 font-mono text-xs leading-relaxed text-ink-muted">
      {{ training.description }}
    </p>

    <div class="mt-auto flex flex-col items-start gap-1.5 pt-1">
      <span class="pill" :class="dueClasses(item.status)">{{ label }}</span>
      <div class="flex w-full flex-wrap items-center gap-1.5">
        <span class="pill bg-white/80 text-ink-muted"><Clock class="h-3 w-3" /> {{ t('trainingCard.hours', { hours: training.durationHours }) }}</span>
        <span class="pill bg-white/80 text-ink-muted">{{ training.category }}</span>
        <span class="pill bg-white/80 text-ink-light">{{ cycleLabel(t, training.cycleYears) }}</span>
        <!-- Flag missing content; it explains why Start is disabled below. -->
        <span v-if="!readiness.hasMaterial" class="pill bg-amber-100 text-amber-700">
          <AlertTriangle class="h-3 w-3" /> {{ t('trainingCard.noMaterial') }}
        </span>
        <span v-if="!readiness.hasQuestions" class="pill bg-amber-100 text-amber-700">
          <AlertTriangle class="h-3 w-3" /> {{ t('trainingCard.noTest') }}
        </span>
        <button
          class="btn-primary btn-sm ml-auto shrink-0"
          :class="{ '!bg-ink-light/60': !actionable && readiness.ready }"
          :disabled="!readiness.ready"
          :title="
            !readiness.ready
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
