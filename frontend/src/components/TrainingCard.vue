<script setup lang="ts">
import { computed } from 'vue';
import { Clock, Play } from 'lucide-vue-next';
import type { DueTraining } from '@/types';
import { dueLabel, dueClasses, isActionable, categoryTint } from '@/utils/display';

const props = defineProps<{ item: DueTraining }>();
const emit = defineEmits<{ start: [id: string] }>();

const t = computed(() => props.item.training);
const tint = computed(() => categoryTint(t.value.category));
const actionable = computed(() => isActionable(props.item.status));
</script>

<template>
  <div
    class="card flex flex-col gap-3 bg-gradient-to-br to-white p-5 transition-transform hover:-translate-y-0.5 hover:shadow-lift"
    :class="tint"
  >
    <div class="flex items-start justify-between gap-2">
      <h3 class="font-sans text-base font-bold leading-snug text-ink">{{ t.name }}</h3>
      <span class="pill" :class="dueClasses(item.status)">
        {{ dueLabel(item.status, item.dueDate) }}
      </span>
    </div>

    <p class="line-clamp-3 font-mono text-[13px] leading-relaxed text-ink-muted">
      {{ t.description }}
    </p>

    <div class="mt-auto flex items-center justify-between pt-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="pill bg-white/80 text-ink-muted">
          <Clock class="h-3 w-3" /> {{ t.durationHours }}h
        </span>
        <span class="pill bg-white/80 text-ink-muted">{{ t.category }}</span>
        <span class="pill bg-white/80 text-ink-light">every {{ t.cycleYears }}y</span>
      </div>
      <button
        class="btn-primary !px-3 !py-1.5"
        :class="{ '!bg-ink-light/60': !actionable }"
        :title="actionable ? 'Start session' : 'Not due yet — you can still review'"
        @click="emit('start', t.id)"
      >
        <Play class="h-3.5 w-3.5" /> Start
      </button>
    </div>
  </div>
</template>
