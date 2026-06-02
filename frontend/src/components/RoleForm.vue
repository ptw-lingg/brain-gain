<script setup lang="ts">
import type { JobRole, Training } from '@/types';

defineProps<{ draft: JobRole; trainings: Training[] }>();
defineEmits<{ toggle: [id: string] }>();
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="form-label">Name</span>
        <input v-model="draft.name" class="bg-input" placeholder="e.g. Lab Technician" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="form-label">Description</span>
        <input v-model="draft.description" class="bg-input" />
      </label>
    </div>

    <div>
      <span class="form-label">Required trainings</span>
      <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label
          v-for="t in trainings"
          :key="t.id"
          class="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 py-2 font-mono text-sm transition hover:bg-pastel-sky/30"
          :class="draft.trainingIds.includes(t.id) ? 'border-accent bg-accent-light/30' : ''"
        >
          <input
            type="checkbox"
            class="accent-accent"
            :checked="draft.trainingIds.includes(t.id)"
            @change="$emit('toggle', t.id)"
          />
          {{ t.name }}
        </label>
      </div>
      <p v-if="trainings.length === 0" class="mt-2 font-mono text-xs text-ink-light">
        No trainings exist yet.
      </p>
    </div>
  </div>
</template>

<style scoped>
.form-label {
  @apply font-sans text-xs font-semibold text-ink-muted;
}
</style>
