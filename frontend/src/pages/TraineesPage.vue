<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronDown, Copy, Users } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { DueStatus, TraineeGroup } from '@/types';
import { dueLabel, dueClasses, formatDate } from '@/utils/display';

const toast = useToastStore();

const groups = ref<TraineeGroup[]>([]);
const loading = ref(true);
const onlyDue = ref(true);
const open = ref<Record<string, boolean>>({});

const ACTIONABLE: DueStatus[] = ['never', 'due', 'overdue'];

function visibleTrainees(g: TraineeGroup) {
  return onlyDue.value ? g.trainees.filter((t) => ACTIONABLE.includes(t.status)) : g.trainees;
}

function dueTotal(g: TraineeGroup): number {
  return g.trainees.filter((t) => ACTIONABLE.includes(t.status)).length;
}

const grandTotalEmails = computed(() => {
  const set = new Set<string>();
  for (const g of groups.value) visibleTrainees(g).forEach((t) => set.add(t.user.email));
  return [...set];
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await client.get<TraineeGroup[]>('/trainings/trainees');
    groups.value = data;
    data.forEach((g) => (open.value[g.training.id] = true));
  } finally {
    loading.value = false;
  }
}

async function copy(emails: string[], label: string): Promise<void> {
  if (emails.length === 0) {
    toast.error('No matching recipients');
    return;
  }
  try {
    await navigator.clipboard.writeText(emails.join('; '));
    toast.success(`Copied ${emails.length} email${emails.length === 1 ? '' : 's'} — ${label}`);
  } catch {
    toast.error('Clipboard not available');
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="page-title">Trainees</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">
          // who must complete your trainings
        </p>
      </div>
      <div class="flex items-center gap-3">
        <label class="flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-muted">
          <input v-model="onlyDue" type="checkbox" class="accent-accent" />
          Only show due / overdue
        </label>
        <button class="btn-primary" @click="copy(grandTotalEmails, 'all groups')">
          <Copy class="h-4 w-4" /> Copy all emails
        </button>
      </div>
    </header>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 2" :key="n" class="card h-24 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else-if="groups.length === 0" class="mt-16 flex flex-col items-center gap-3 text-center">
      <div class="flex h-16 w-16 items-center justify-center rounded-full bg-pastel-sky/50">
        <Users class="h-8 w-8 text-accent" />
      </div>
      <p class="font-mono text-sm text-ink-muted">No one is currently assigned to your trainings.</p>
    </div>

    <div v-else class="mt-6 flex flex-col gap-3">
      <div v-for="g in groups" :key="g.training.id" class="card overflow-hidden">
        <!-- Group header -->
        <div class="flex items-center gap-3 px-5 py-4">
          <button
            class="flex min-w-0 flex-1 items-center gap-3 text-left"
            @click="open[g.training.id] = !open[g.training.id]"
          >
            <ChevronDown
              class="h-4 w-4 shrink-0 text-ink-light transition"
              :class="open[g.training.id] ? '' : '-rotate-90'"
            />
            <div class="min-w-0">
              <div class="font-sans text-sm font-semibold text-ink">{{ g.training.name }}</div>
              <div class="font-mono text-xs text-ink-light">
                {{ g.trainees.length }} assigned · {{ dueTotal(g) }} due
              </div>
            </div>
          </button>
          <button
            class="btn-ghost !px-3 !py-1.5 !text-xs"
            @click="copy(visibleTrainees(g).map((t) => t.user.email), g.training.name)"
          >
            <Copy class="h-3.5 w-3.5" /> Copy emails
          </button>
        </div>

        <!-- Trainees -->
        <Transition name="list">
          <div v-if="open[g.training.id]" class="border-t border-line">
            <div
              v-for="t in visibleTrainees(g)"
              :key="t.user.id"
              class="flex items-center gap-3 px-5 py-2.5 even:bg-pastel-sky/10"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-ink">{{ t.user.name }}</div>
                <div class="truncate font-mono text-xs text-ink-light" :title="t.user.email">{{ t.user.email }}</div>
              </div>
              <span v-if="t.dueDate" class="hidden font-mono text-[11px] text-ink-light sm:inline">
                due {{ formatDate(t.dueDate) }}
              </span>
              <span class="pill pill-col shrink-0" :class="dueClasses(t.status)">
                {{ dueLabel(t.status, t.dueDate) }}
              </span>
            </div>
            <p
              v-if="visibleTrainees(g).length === 0"
              class="px-5 py-3 font-mono text-xs text-ink-light"
            >
              {{ onlyDue ? 'Nobody is currently due for this training.' : 'No one assigned.' }}
            </p>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>
