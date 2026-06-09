<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Sprout } from 'lucide-vue-next';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { DueTraining } from '@/types';
import TrainingCard from '@/components/TrainingCard.vue';

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

const items = ref<DueTraining[]>([]);
const loading = ref(true);

const greeting = computed(() => {
  const h = new Date().getHours();
  const key = h < 12 ? 'greetingMorning' : h < 18 ? 'greetingAfternoon' : 'greetingEvening';
  return t(`dashboard.${key}`, { name: auth.user?.name ?? '' });
});

const dueCount = computed(
  () => items.value.filter((i) => i.status !== 'up-to-date').length,
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await client.get<DueTraining[]>('/trainings/mine');
    items.value = data;
  } finally {
    loading.value = false;
  }
}

function start(id: string): void {
  router.push(`/session/${id}`);
}

onMounted(load);
</script>

<template>
  <div>
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="page-title">{{ greeting }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">
          {{ t('dashboard.subtitle', { assigned: items.length, due: dueCount }) }}
        </p>
      </div>
    </header>

    <!-- Loading skeletons -->
    <div v-if="loading" class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="n in 3" :key="n" class="card h-44 animate-pulse bg-pastel-slate/30" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="items.length === 0"
      class="mt-16 flex flex-col items-center gap-3 text-center"
    >
      <div class="flex h-16 w-16 items-center justify-center rounded-full bg-pastel-mint/50">
        <Sprout class="h-8 w-8 text-emerald-500" />
      </div>
      <p class="font-mono text-sm text-ink-muted">
        {{ t('dashboard.empty') }}
      </p>
    </div>

    <!-- Grid -->
    <TransitionGroup
      v-else
      name="list"
      tag="div"
      class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <TrainingCard v-for="i in items" :key="i.training.id" :item="i" @start="start" />
    </TransitionGroup>
  </div>
</template>
