<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Save, SlidersHorizontal } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { Settings } from '@/types';

const toast = useToastStore();

const pct = ref(80);
const loading = ref(true);
const saving = ref(false);

const pctLabel = computed(() => `${pct.value}%`);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await client.get<Settings>('/settings');
    pct.value = Math.round(data.passThreshold * 100);
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    await client.put('/settings', { passThreshold: pct.value / 100 });
    toast.success('Pass threshold updated for all trainings');
  } catch {
    toast.error('Could not save settings');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-xl">
    <header>
      <h1 class="page-title">Settings</h1>
      <p class="mt-1 font-mono text-xs text-ink-light">// applies to every training at once</p>
    </header>

    <div v-if="loading" class="mt-6 card h-40 animate-pulse bg-pastel-slate/30" />

    <div v-else class="mt-6 card p-6">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
          <SlidersHorizontal class="h-5 w-5 text-accent" />
        </div>
        <div>
          <h2 class="font-sans text-sm font-bold text-ink">Global pass threshold</h2>
          <p class="font-mono text-xs text-ink-light">
            Minimum score a user must reach to pass any training's test.
          </p>
        </div>
      </div>

      <div class="mt-6 flex items-center gap-4">
        <input
          v-model.number="pct"
          type="range"
          min="50"
          max="100"
          step="5"
          class="flex-1 accent-accent"
        />
        <span class="w-16 text-right font-sans text-2xl font-bold text-accent">{{ pctLabel }}</span>
      </div>

      <div class="mt-6">
        <button class="btn-primary" :disabled="saving" @click="save">
          <Save class="h-4 w-4" /> {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </div>
  </div>
</template>
