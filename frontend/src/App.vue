<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { CheckCircle2, AlertTriangle, X } from 'lucide-vue-next';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();
const { toasts } = storeToRefs(toast);
</script>

<template>
  <RouterView v-slot="{ Component }">
    <Transition name="fade-slide" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>

  <!-- Global toast host -->
  <div class="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
    <TransitionGroup name="list">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-2 rounded-lg border bg-white px-3 py-2.5 shadow-lift"
        :class="t.type === 'error' ? 'border-rose-200' : 'border-line'"
      >
        <CheckCircle2 v-if="t.type === 'success'" class="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <AlertTriangle v-else class="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
        <span class="flex-1 font-mono text-xs text-ink">{{ t.message }}</span>
        <button class="text-ink-light hover:text-ink" @click="toast.dismiss(t.id)">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
