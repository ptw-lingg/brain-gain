<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, Download, FileText, UsersRound, X } from 'lucide-vue-next';
import type { TCreatedPdf } from 'pdfmake/interfaces';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import type { DueStatus, MyTeam, Settings, TeamMember } from '@/types';
import { dueClasses, formatDate } from '@/utils/display';
import ListControls from '@/components/ListControls.vue';
import { matchesQuery } from '@/utils/listFilter';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const team = ref<MyTeam>({ units: [], members: [] });
const companyName = ref('');
const loading = ref(true);

// Training-status-report PDF: build → preview inline (pdf.js page images) → gated download (view-before-download).
const building = ref(false);
const previewPages = ref<string[]>([]);
const reportOpen = ref(false);
let currentPdf: TCreatedPdf | null = null;
let reportFileName = '';
const onlyDue = ref(false);
const open = ref<Record<string, boolean>>({});
const search = ref('');

const ACTIONABLE: DueStatus[] = ['never', 'due', 'overdue'];

/** Members grouped by their org unit name, so the view reads unit-by-unit. */
const groups = computed(() => {
  const byUnit = new Map<string, TeamMember[]>();
  for (const m of team.value.members) {
    if (!byUnit.has(m.orgUnitName)) byUnit.set(m.orgUnitName, []);
    byUnit.get(m.orgUnitName)!.push(m);
  }
  return [...byUnit.entries()]
    .map(([name, members]) => ({
      name,
      members: [...members].sort((a, b) => a.user.name.localeCompare(b.user.name)), // alphabetical members
    }))
    .sort((a, b) => a.name.localeCompare(b.name)); // alphabetical units
});

// Groups with their members narrowed by the search box (matches member name/email, unit name, or any
// of the member's training names); empty groups drop out.
const filteredGroups = computed(() =>
  groups.value
    .map((g) => ({
      name: g.name,
      members: g.members.filter((m) =>
        matchesQuery(search.value, m.user.name, m.user.email, g.name, ...m.trainings.map((tr) => tr.name)),
      ),
    }))
    .filter((g) => g.members.length > 0),
);

const shownMemberCount = computed(() => filteredGroups.value.reduce((n, g) => n + g.members.length, 0));

// Expand/collapse every (shown) member card at once.
const shownMembers = computed(() => filteredGroups.value.flatMap((g) => g.members));
const allExpanded = computed(
  () => shownMembers.value.length > 0 && shownMembers.value.every((m) => open.value[m.user.id]),
);
function toggleAll(): void {
  const next = !allExpanded.value;
  for (const m of shownMembers.value) open.value[m.user.id] = next;
}

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
    const [teamRes, settingsRes] = await Promise.all([
      client.get<MyTeam>('/org-units/my-team'),
      client.get<Settings>('/settings'),
    ]);
    team.value = teamRes.data;
    companyName.value = settingsRes.data.companyName ?? '';
    teamRes.data.members.forEach((m) => (open.value[m.user.id] = true));
  } finally {
    loading.value = false;
  }
}

// Build the report and render it to page images for inline review (no browser download yet).
async function openReport(): Promise<void> {
  building.value = true;
  reportOpen.value = true;
  previewPages.value = [];
  try {
    const { buildTeamReport } = await import('@/utils/teamReport');
    const { createPdf } = await import('@/utils/pdf');
    const { renderPdfToImages } = await import('@/utils/pdfPreview');
    const { def, fileName } = buildTeamReport(
      team.value,
      {
        company: companyName.value,
        headName: auth.user?.name ?? '',
        generatedOn: new Date().toISOString().slice(0, 10),
      },
      t,
    );
    reportFileName = fileName;
    currentPdf = createPdf(def);
    const bytes = await (await currentPdf.getBlob()).arrayBuffer();
    previewPages.value = await renderPdfToImages(bytes);
  } catch {
    toast.error(t('myTeam.reportError'));
    closeReport();
  } finally {
    building.value = false;
  }
}

// Download is reachable only from the open preview (view-before-download).
function downloadReport(): void {
  if (currentPdf) currentPdf.download(reportFileName);
}

function closeReport(): void {
  reportOpen.value = false;
  building.value = false;
  previewPages.value = [];
  currentPdf = null;
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
      <div class="flex items-center gap-3">
        <label class="flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-muted">
          <input v-model="onlyDue" type="checkbox" class="accent-accent" />
          {{ t('myTeam.onlyDue') }}
        </label>
        <button
          class="btn-primary"
          :disabled="team.members.length === 0 || building"
          @click="openReport"
        >
          <FileText class="h-4 w-4" /> {{ t('myTeam.report') }}
        </button>
      </div>
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

    <div v-else class="mt-6">
      <ListControls
        v-model:query="search"
        :count="shownMemberCount"
        :total="team.members.length"
        expandable
        :all-expanded="allExpanded"
        @toggle-all="toggleAll"
      />
      <div class="flex flex-col gap-5">
      <section v-for="g in filteredGroups" :key="g.name">
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
      <p v-if="filteredGroups.length === 0" class="font-mono text-sm text-ink-light">{{ t('common.noMatches') }}</p>
      </div>
    </div>

    <!-- Report preview → gated download (view-before-download) -->
    <Transition name="fade-slide">
      <div v-if="reportOpen" class="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-ink/40" @click="closeReport" />
        <div class="relative z-10 flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-lift">
          <div class="flex items-center justify-between border-b border-line px-5 py-3">
            <div>
              <h2 class="font-sans text-base font-bold text-ink">{{ t('myTeam.reportTitle') }}</h2>
              <p class="font-mono text-[11px] text-ink-light">
                <span v-if="!building">{{ t('myTeam.reportPages', { pages: previewPages.length }) }}</span>
                <span v-else>{{ t('myTeam.reportRendering') }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn-primary !px-3 !py-1.5 !text-xs" :disabled="building || previewPages.length === 0" @click="downloadReport">
                <Download class="h-4 w-4" /> {{ t('myTeam.downloadPdf') }}
              </button>
              <button class="text-ink-light hover:text-ink" :title="t('common.close')" @click="closeReport"><X class="h-5 w-5" /></button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto bg-pastel-slate/20 p-4">
            <div v-if="previewPages.length" class="mx-auto flex max-w-3xl flex-col items-center gap-3">
              <img v-for="(p, i) in previewPages" :key="i" :src="p" data-pdf-page class="w-full rounded shadow-soft" :alt="t('myTeam.pageAlt', { n: i + 1 })" />
            </div>
            <div v-else class="flex h-full items-center justify-center font-mono text-sm text-ink-light">{{ t('myTeam.reportRendering') }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
