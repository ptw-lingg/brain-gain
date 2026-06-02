<script setup lang="ts">
import { Plus, Trash2, Link as LinkIcon, HelpCircle } from 'lucide-vue-next';
import type { Question, SafeUser, Training } from '@/types';

defineProps<{
  draft: Training;
  isAdmin: boolean;
  owners: SafeUser[];
}>();

defineEmits<{
  'add-link': [];
  'remove-link': [i: number];
  'add-question': [];
  'remove-question': [i: number];
  'add-option': [q: Question];
  'remove-option': [q: Question, oi: number];
}>();

const cycleOptions = [1, 2, 3, 4, 5];
const windowOptions = [0, 1, 2, 3];
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Basic fields -->
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="form-label">Name</span>
        <input v-model="draft.name" class="bg-input" placeholder="Training name" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="form-label">Category</span>
        <input v-model="draft.category" class="bg-input" placeholder="e.g. Safety" />
      </label>
      <label class="flex flex-col gap-1 sm:col-span-2">
        <span class="form-label">Description</span>
        <textarea v-model="draft.description" rows="2" class="bg-input resize-none" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="form-label">Duration (hours)</span>
        <input v-model.number="draft.durationHours" type="number" min="0" step="0.5" class="bg-input" />
      </label>
      <label v-if="isAdmin" class="flex flex-col gap-1">
        <span class="form-label">Owner (trainer)</span>
        <select v-model="draft.ownerId" class="bg-input">
          <option v-for="o in owners" :key="o.id" :value="o.id">{{ o.name }} ({{ o.email }})</option>
        </select>
      </label>
    </div>

    <!-- Cycle + window -->
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label class="flex flex-col gap-1">
        <span class="form-label">Repeat every (years)</span>
        <select v-model.number="draft.cycleYears" class="bg-input">
          <option v-for="y in cycleOptions" :key="y" :value="y">{{ y }} year{{ y > 1 ? 's' : '' }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="form-label">Window opens (months before)</span>
        <select v-model.number="draft.windowBeforeMonths" class="bg-input">
          <option v-for="m in windowOptions" :key="m" :value="m">{{ m }} month{{ m === 1 ? '' : 's' }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="form-label">Grace (months after)</span>
        <select v-model.number="draft.windowAfterMonths" class="bg-input">
          <option v-for="m in windowOptions" :key="m" :value="m">{{ m }} month{{ m === 1 ? '' : 's' }}</option>
        </select>
      </label>
    </div>

    <!-- Material links -->
    <div>
      <div class="mb-2 flex items-center gap-2">
        <LinkIcon class="h-4 w-4 text-accent" />
        <span class="form-label !text-ink">Material (OneDrive links)</span>
      </div>
      <div class="flex flex-col gap-2">
        <div v-for="(link, i) in draft.materialLinks" :key="i" class="flex gap-2">
          <input v-model="link.label" class="bg-input flex-1" placeholder="Label" />
          <input v-model="link.url" class="bg-input flex-[2]" placeholder="https://onedrive…" />
          <button class="btn-ghost !px-2" @click="$emit('remove-link', i)">
            <Trash2 class="h-4 w-4" />
          </button>
        </div>
      </div>
      <button class="btn-ghost mt-2 !px-3 !py-1.5 !text-xs" @click="$emit('add-link')">
        <Plus class="h-3.5 w-3.5" /> Add link
      </button>
    </div>

    <!-- Questions -->
    <div>
      <div class="mb-2 flex items-center gap-2">
        <HelpCircle class="h-4 w-4 text-accent" />
        <span class="form-label !text-ink">Multiple-choice questions</span>
      </div>
      <div class="flex flex-col gap-3">
        <div
          v-for="(q, qi) in draft.questions"
          :key="qi"
          class="rounded-lg border border-line bg-white p-3"
        >
          <div class="flex gap-2">
            <input v-model="q.text" class="bg-input flex-1" :placeholder="`Question ${qi + 1}`" />
            <button class="btn-ghost !px-2" @click="$emit('remove-question', qi)">
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
          <p class="mt-2 font-mono text-[10px] uppercase tracking-wide text-ink-light">
            Select the correct answer
          </p>
          <div class="mt-1 flex flex-col gap-1.5">
            <div v-for="(_opt, oi) in q.options" :key="oi" class="flex items-center gap-2">
              <input
                type="radio"
                :name="`correct-${qi}`"
                :checked="q.correctIndex === oi"
                class="accent-accent"
                @change="q.correctIndex = oi"
              />
              <input v-model="q.options[oi]" class="bg-input flex-1" :placeholder="`Option ${oi + 1}`" />
              <button
                class="btn-ghost !px-2"
                :disabled="q.options.length <= 2"
                @click="$emit('remove-option', q, oi)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <button class="btn-ghost mt-2 !px-3 !py-1 !text-xs" @click="$emit('add-option', q)">
            <Plus class="h-3 w-3" /> Add option
          </button>
        </div>
      </div>
      <button class="btn-ghost mt-2 !px-3 !py-1.5 !text-xs" @click="$emit('add-question')">
        <Plus class="h-3.5 w-3.5" /> Add question
      </button>
    </div>
  </div>
</template>

<style scoped>
.form-label {
  @apply font-sans text-xs font-semibold text-ink-muted;
}
</style>
