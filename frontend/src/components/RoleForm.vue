<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { JobRole, Training } from '@/types';
import { resolveLocalized } from '@/utils/locales';

const { t, locale } = useI18n();

defineProps<{ draft: JobRole; trainings: Training[] }>();
defineEmits<{ toggle: [id: string] }>();

// Checkbox labels show the localized training name resolved to the UI language (English fallback).
const trainingLabel = (tr: Training): string => resolveLocalized(tr.name, locale.value).value;
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="form-label">{{ t('roleForm.name') }}</span>
        <input v-model="draft.name" class="bg-input" :placeholder="t('roleForm.namePlaceholder')" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="form-label">{{ t('roleForm.description') }}</span>
        <input v-model="draft.description" class="bg-input" />
      </label>
    </div>

    <div>
      <span class="form-label">{{ t('roleForm.requiredTrainings') }}</span>
      <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label
          v-for="t in trainings"
          :key="t.id"
          class="check-card"
          :class="draft.trainingIds.includes(t.id) ? 'border-accent bg-accent-light/30' : ''"
        >
          <input
            type="checkbox"
            class="accent-accent"
            :checked="draft.trainingIds.includes(t.id)"
            @change="$emit('toggle', t.id)"
          />
          {{ trainingLabel(t) }}
        </label>
      </div>
      <p v-if="trainings.length === 0" class="mt-2 font-mono text-xs text-ink-light">
        {{ t('roleForm.noTrainings') }}
      </p>
    </div>
  </div>
</template>
