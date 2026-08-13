<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Sprout } from 'lucide-vue-next';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { DueTraining } from '@/types';
import TrainingCard from '@/components/TrainingCard.vue';
import ListControls from '@/components/ListControls.vue';
import { matchesQuery } from '@/utils/listFilter';
import { formatDuration } from '@/utils/display';

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

const items = ref<DueTraining[]>([]);
const loading = ref(true);
const search = ref('');
// On by default: the dashboard is a work list — what still has to be done. Unchecking shows the
// up-to-date trainings too (e.g. to review one that isn't due yet).
const onlyDue = ref(true);

const filteredItems = computed(() =>
  items.value.filter(
    (i) =>
      (!onlyDue.value || i.status !== 'up-to-date') &&
      matchesQuery(search.value, i.training.name, i.training.description, i.training.category),
  ),
);

const greeting = computed(() => {
  const h = new Date().getHours();
  const key = h < 12 ? 'greetingMorning' : h < 18 ? 'greetingAfternoon' : 'greetingEvening';
  return t(`dashboard.${key}`, { name: auth.user?.name ?? '' });
});

const dueItems = computed(() => items.value.filter((i) => i.status !== 'up-to-date'));
const dueCount = computed(() => dueItems.value.length);

// The subtitle also sums up what the due work amounts to, e.g. "2 assigned · 2 due now · 5 h".
const subtitle = computed(() => {
  const base = t('dashboard.subtitle', { assigned: items.value.length, due: dueCount.value });
  if (dueCount.value === 0) return base;
  const total = dueItems.value.reduce((sum, i) => sum + (i.training.durationMinutes || 0), 0);
  return `${base} · ${formatDuration(total)}`;
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await client.get<DueTraining[]>('/trainings/mine');
    items.value = data.sort((a, b) => a.training.name.localeCompare(b.training.name)); // alphabetical, easy to find
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
          {{ subtitle }}
        </p>
      </div>
    </header>

    <!-- Loading skeletons -->
    <div v-if="loading" class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <div v-for="n in 3" :key="n" class="card h-32 animate-pulse bg-pastel-slate/30" />
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
    <div v-else class="mt-8">
      <div class="flex flex-wrap items-center gap-4">
        <div class="min-w-0 flex-1">
          <ListControls
            v-model:query="search"
            :count="filteredItems.length"
            :total="items.length"
          />
        </div>
        <label class="flex cursor-pointer items-center gap-2 pb-4 font-mono text-xs text-ink-muted">
          <input v-model="onlyDue" type="checkbox" class="accent-accent" />
          {{ t('dashboard.onlyDue') }}
        </label>
      </div>
      <TransitionGroup
        name="list"
        tag="div"
        class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <TrainingCard v-for="i in filteredItems" :key="i.training.id" :item="i" @start="start" />
      </TransitionGroup>
      <p v-if="filteredItems.length === 0" class="font-mono text-sm text-ink-light">{{ t('common.noMatches') }}</p>
    </div>
  </div>
</template>
