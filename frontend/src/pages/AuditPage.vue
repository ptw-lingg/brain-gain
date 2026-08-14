<script setup lang="ts">
// Admin-only audit trail viewer: server-side filtered + paged list of audit entries (newest first),
// expandable field-level diffs on updates, and a CSV export of the current filter.
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, ChevronLeft, ChevronRight, Download, ScrollText } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { AuditAction, AuditEntityType, AuditEntry, AuditListResponse } from '@/types';
import { formatDateTime } from '@/utils/display';
import { apiErrorMessage, downloadFile } from '@/utils/download';

const { t } = useI18n();
const toast = useToastStore();

const entries = ref<AuditEntry[]>([]);
const total = ref(0);
const loading = ref(true);
const exporting = ref(false);
const expandedId = ref<string | null>(null);

// Filters — mapped 1:1 to the API's query params.
const fAction = ref('');
const fEntityType = ref('');
const fText = ref('');
const fFrom = ref('');
const fTo = ref('');
const offset = ref(0);
const LIMIT = 50;

const ACTIONS: AuditAction[] = [
  'create', 'update', 'delete', 'import',
  'login', 'login-failed', 'sso-login', 'activate', 'impersonate',
  'backup-create', 'backup-upload', 'backup-delete', 'backup-restore', 'backup-restore-failed',
  'training-completed',
];
const ENTITY_TYPES: AuditEntityType[] = ['user', 'role', 'training', 'material', 'orgUnit', 'settings', 'backup', 'auth', 'session'];

// Badge tone per action family — additions are visible immediately (unknown actions fall back to slate).
const ACTION_CLS: Partial<Record<AuditAction, string>> = {
  create: 'bg-pastel-mint/60 text-emerald-700',
  update: 'bg-pastel-blue/50 text-ink',
  delete: 'bg-rose-100 text-rose-700',
  import: 'bg-pastel-blue/50 text-ink',
  login: 'bg-pastel-cyan/60 text-petrol-700',
  'login-failed': 'bg-amber-100 text-amber-700',
  'sso-login': 'bg-pastel-cyan/60 text-petrol-700',
  activate: 'bg-pastel-cyan/60 text-petrol-700',
  impersonate: 'bg-amber-100 text-amber-700',
  'backup-create': 'bg-pastel-slate/50 text-ink-muted',
  'backup-upload': 'bg-pastel-slate/50 text-ink-muted',
  'backup-delete': 'bg-rose-100 text-rose-700',
  'backup-restore': 'bg-amber-100 text-amber-700',
  'backup-restore-failed': 'bg-rose-100 text-rose-700',
  'training-completed': 'bg-pastel-mint/60 text-emerald-700',
};

function filterParams(): Record<string, string> {
  const params: Record<string, string> = {};
  if (fAction.value) params.action = fAction.value;
  if (fEntityType.value) params.entityType = fEntityType.value;
  if (fText.value.trim()) params.q = fText.value.trim();
  if (fFrom.value) params.from = fFrom.value;
  if (fTo.value) params.to = fTo.value;
  return params;
}

async function load(): Promise<void> {
  loading.value = entries.value.length === 0;
  try {
    const { data } = await client.get<AuditListResponse>('/audit', {
      params: { ...filterParams(), offset: offset.value, limit: LIMIT },
    });
    entries.value = data.entries;
    total.value = data.total;
    expandedId.value = null;
  } catch {
    toast.error(t('audit.toasts.loadError'));
  } finally {
    loading.value = false;
  }
}

// Filter changes reset paging and reload; the free-text input is debounced so typing doesn't
// fire a request per keystroke.
let textTimer: ReturnType<typeof setTimeout> | undefined;
watch([fAction, fEntityType, fFrom, fTo], () => {
  offset.value = 0;
  void load();
});
watch(fText, () => {
  clearTimeout(textTimer);
  textTimer = setTimeout(() => {
    offset.value = 0;
    void load();
  }, 300);
});
watch(offset, () => void load());

async function exportCsv(): Promise<void> {
  exporting.value = true;
  try {
    const qs = new URLSearchParams(filterParams()).toString();
    await downloadFile(`/audit/export.csv${qs ? `?${qs}` : ''}`, 'braingain-audit.csv');
  } catch (err) {
    toast.error((await apiErrorMessage(err)) || t('audit.toasts.exportError'));
  } finally {
    exporting.value = false;
  }
}

const rangeText = computed(() => {
  if (total.value === 0) return '';
  const first = offset.value + 1;
  const last = Math.min(offset.value + LIMIT, total.value);
  return t('audit.range', { first, last, total: total.value });
});

const actorLabel = (e: AuditEntry): string => e.actor?.email ?? t('audit.system');
const cellValue = (v: unknown): string => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const toggleExpand = (e: AuditEntry): void => {
  expandedId.value = expandedId.value === e.id ? null : e.id;
};

onMounted(load);
</script>

<template>
  <div>
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="page-title">{{ t('audit.title') }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">{{ t('audit.subtitle', { total }) }}</p>
      </div>
      <button class="btn-ghost" :disabled="exporting || total === 0" data-testid="audit-export" @click="exportCsv">
        <Download class="h-4 w-4" />
        {{ t('audit.exportCsv') }}
      </button>
    </header>

    <!-- Filter bar -->
    <div class="mt-5 card flex flex-wrap items-end gap-3 p-4">
      <label class="flex flex-col gap-1">
        <span class="font-mono text-[11px] uppercase tracking-wide text-ink-light">{{ t('audit.filterAction') }}</span>
        <select v-model="fAction" class="bg-input" data-testid="audit-filter-action">
          <option value="">{{ t('audit.filterAll') }}</option>
          <option v-for="a in ACTIONS" :key="a" :value="a">{{ t(`audit.actions.${a}`) }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="font-mono text-[11px] uppercase tracking-wide text-ink-light">{{ t('audit.filterEntityType') }}</span>
        <select v-model="fEntityType" class="bg-input" data-testid="audit-filter-entity">
          <option value="">{{ t('audit.filterAll') }}</option>
          <option v-for="et in ENTITY_TYPES" :key="et" :value="et">{{ t(`audit.entities.${et}`) }}</option>
        </select>
      </label>
      <label class="flex min-w-48 flex-1 flex-col gap-1">
        <span class="font-mono text-[11px] uppercase tracking-wide text-ink-light">{{ t('audit.filterText') }}</span>
        <input v-model="fText" type="search" class="bg-input" :placeholder="t('audit.filterTextPlaceholder')" data-testid="audit-filter-text" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="font-mono text-[11px] uppercase tracking-wide text-ink-light">{{ t('audit.filterFrom') }}</span>
        <input v-model="fFrom" type="date" class="bg-input" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="font-mono text-[11px] uppercase tracking-wide text-ink-light">{{ t('audit.filterTo') }}</span>
        <input v-model="fTo" type="date" class="bg-input" />
      </label>
    </div>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 3" :key="n" class="card h-14 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else class="mt-6 card overflow-hidden">
      <table class="w-full text-left">
        <thead class="border-b border-line bg-pastel-sky/20">
          <tr class="font-mono text-[11px] uppercase tracking-wide text-ink-light">
            <th class="px-5 py-3">{{ t('audit.thTime') }}</th>
            <th class="px-5 py-3">{{ t('audit.thActor') }}</th>
            <th class="px-5 py-3">{{ t('audit.thAction') }}</th>
            <th class="px-5 py-3">{{ t('audit.thEntity') }}</th>
            <th class="hidden px-5 py-3 lg:table-cell">{{ t('audit.thDetails') }}</th>
            <th class="w-10 px-3 py-3"><span class="sr-only">{{ t('audit.changesTitle') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="e in entries" :key="e.id">
            <tr class="border-b border-line/60 last:border-0" :data-testid="`audit-row-${e.action}`">
              <td class="whitespace-nowrap px-5 py-3 font-mono text-xs text-ink-muted">{{ formatDateTime(e.timestamp) }}</td>
              <td class="px-5 py-3">
                <span class="font-mono text-xs font-semibold text-ink">{{ actorLabel(e) }}</span>
                <span v-if="e.actor?.impersonatorEmail" class="pill ml-2 bg-amber-100 text-amber-700">
                  {{ t('audit.viaImpersonator', { email: e.actor.impersonatorEmail }) }}
                </span>
              </td>
              <td class="px-5 py-3">
                <span class="pill" :class="ACTION_CLS[e.action] ?? 'bg-pastel-slate/50 text-ink-muted'">{{ t(`audit.actions.${e.action}`) }}</span>
              </td>
              <td class="px-5 py-3">
                <span class="font-mono text-[11px] uppercase text-ink-light">{{ t(`audit.entities.${e.entityType}`) }}</span>
                <span v-if="e.entityName" class="ml-2 text-sm text-ink">{{ e.entityName }}</span>
              </td>
              <td class="hidden px-5 py-3 font-mono text-xs text-ink-muted lg:table-cell">{{ e.details ?? '' }}</td>
              <td class="px-3 py-3 text-right">
                <button
                  v-if="e.changes?.length"
                  class="btn-ghost btn-sm"
                  :title="t('audit.changesTitle')"
                  :data-testid="`audit-expand-${e.id}`"
                  @click="toggleExpand(e)"
                >
                  <ChevronDown class="h-4 w-4 transition" :class="expandedId === e.id ? 'rotate-180' : ''" />
                </button>
              </td>
            </tr>
            <!-- Expandable field/before/after diff -->
            <tr v-if="expandedId === e.id && e.changes?.length" class="border-b border-line/60 bg-pastel-sky/10 last:border-0">
              <td colspan="6" class="px-5 py-3">
                <table class="w-full text-left" data-testid="audit-changes">
                  <thead>
                    <tr class="font-mono text-[10px] uppercase tracking-wide text-ink-light">
                      <th class="py-1 pr-4">{{ t('audit.changes.field') }}</th>
                      <th class="py-1 pr-4">{{ t('audit.changes.before') }}</th>
                      <th class="py-1">{{ t('audit.changes.after') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="c in e.changes" :key="c.field" class="align-top font-mono text-xs">
                      <td class="py-1 pr-4 font-semibold text-ink">{{ c.field }}</td>
                      <td class="max-w-64 break-all py-1 pr-4 text-ink-muted">{{ cellValue(c.from) }}</td>
                      <td class="max-w-64 break-all py-1 text-ink">{{ cellValue(c.to) }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
          <tr v-if="entries.length === 0">
            <td colspan="6" class="px-5 py-8 text-center font-mono text-xs text-ink-light">
              <ScrollText class="mx-auto mb-2 h-5 w-5" />
              {{ t('audit.empty') }}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pager -->
      <div v-if="total > 0" class="flex items-center justify-between border-t border-line px-5 py-3">
        <span class="font-mono text-[11px] text-ink-light">{{ rangeText }}</span>
        <div class="flex items-center gap-1">
          <button class="btn-ghost btn-sm" :disabled="offset === 0" @click="offset = Math.max(0, offset - LIMIT)">
            <ChevronLeft class="h-4 w-4" /> {{ t('audit.prev') }}
          </button>
          <button class="btn-ghost btn-sm" :disabled="offset + LIMIT >= total" @click="offset = offset + LIMIT">
            {{ t('audit.next') }} <ChevronRight class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
