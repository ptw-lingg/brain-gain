<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, UsersRound } from 'lucide-vue-next';
import client from '@/api/client';
import type { DueStatus, MyTeam, TeamMember } from '@/types';
import { dueClasses, formatDate } from '@/utils/display';

const { t } = useI18n();

const team = ref<MyTeam>({ units: [], members: [] });
const loading = ref(true);
const onlyDue = ref(false);
const open = ref<Record<string, boolean>>({});

const ACTIONABLE: DueStatus[] = ['never', 'due', 'overdue'];

/** Members grouped by their org unit name, so the view reads unit-by-unit. */
const groups = computed(() => {
  const byUnit = new Map<string, TeamMember[]>();
  for (const m of team.value.members) {
    if (!byUnit.has(m.orgUnitName)) byUnit.set(m.orgUnitName, []);
    byUnit.get(m.orgUnitName)!.push(m);
  }
  return [...byUnit.entries()]
    .map(([name, members]) => ({ name, members }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

function visibleTrainings(m: TeamMember) {
  return onlyDue.value ? m.trainings.filter((tr) => ACTIONABLE.includes(tr.status)) : m.trainings;
}

/** A short due label for one training row (status word + optional date). */
function statusLabel(status: DueStatus, dueDate: string | null): string {
  if (status === 'overdue') return t('due.overdue');
  if (status === 'never') return t('due.now');
  if (status === 'due') return dueDate ? t('due.dueBy', { date: formatDate(dueDate) }) : t('due.now');
  return dueDate ? t('due.upToDateUntil', { date: formatDate(dueDate) }) : t('due.upToDate');
}

function dueCount(m: TeamMember): number {
  return m.trainings.filter((tr) => ACTIONABLE.includes(tr.status)).length;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await client.get<MyTeam>('/org-units/my-team');
    team.value = data;
    data.members.forEach((m) => (open.value[m.user.id] = true));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="page-title">{{ t('myTeam.title') }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">{{ t('myTeam.subtitle') }}</p>
      </div>
      <label class="flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-muted">
        <input v-model="onlyDue" type="checkbox" class="accent-accent" />
        {{ t('myTeam.onlyDue') }}
      </label>
    </header>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 3" :key="n" class="card h-20 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else-if="team.members.length === 0" class="mt-16 flex flex-col items-center gap-3 text-center">
      <div class="flex h-16 w-16 items-center justify-center rounded-full bg-pastel-sky/50">
        <UsersRound class="h-8 w-8 text-accent" />
      </div>
      <p class="font-mono text-sm text-ink-muted">{{ t('myTeam.empty') }}</p>
    </div>

    <div v-else class="mt-6 flex flex-col gap-5">
      <section v-for="g in groups" :key="g.name">
        <h2 class="mb-2 font-sans text-sm font-bold text-ink">
          {{ g.name }} <span class="font-mono text-xs font-normal text-ink-light">· {{ g.members.length }}</span>
        </h2>
        <div class="flex flex-col gap-3">
          <div v-for="m in g.members" :key="m.user.id" class="card overflow-hidden">
            <button
              class="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-pastel-sky/20"
              @click="open[m.user.id] = !open[m.user.id]"
            >
              <ChevronDown
                class="h-4 w-4 shrink-0 text-ink-light transition"
                :class="open[m.user.id] ? '' : '-rotate-90'"
              />
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold text-ink">{{ m.user.name }}</div>
                <div class="truncate font-mono text-xs text-ink-light">{{ m.user.email }}</div>
              </div>
              <span
                class="pill pill-col shrink-0"
                :class="dueCount(m) ? 'bg-rose-100 text-rose-600' : 'bg-pastel-mint/50 text-emerald-700'"
              >
                {{ t('myTeam.dueCount', { count: dueCount(m) }, dueCount(m)) }}
              </span>
            </button>

            <Transition name="list">
              <div v-if="open[m.user.id]" class="border-t border-line">
                <div
                  v-for="tr in visibleTrainings(m)"
                  :key="tr.id"
                  class="flex items-center gap-3 px-5 py-2.5 even:bg-pastel-sky/10"
                >
                  <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ tr.name }}</span>
                  <span class="pill pill-col shrink-0" :class="dueClasses(tr.status)">
                    {{ statusLabel(tr.status, tr.dueDate) }}
                  </span>
                </div>
                <p
                  v-if="visibleTrainings(m).length === 0"
                  class="px-5 py-3 font-mono text-xs text-ink-light"
                >
                  {{ onlyDue ? t('myTeam.nothingDue') : t('myTeam.noTrainings') }}
                </p>
              </div>
            </Transition>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
