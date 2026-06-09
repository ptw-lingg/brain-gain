<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ClipboardPaste, Eye, Upload, Copy, AlertTriangle, Check, ArrowLeft } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { JobRole } from '@/types';

const toast = useToastStore();
const { t } = useI18n();

// One parsed line of the pasted spreadsheet — display-only; the server is authoritative for matching.
interface ParsedRow {
  name: string;
  email: string;
  roles: string[];
}

// Mirrors the plan the backend returns for each row (POST /users/import).
interface PlanRow {
  index: number;
  name: string;
  email: string;
  action: 'create' | 'update' | 'unchanged' | 'error';
  errors: string[];
  matchedRoleIds: string[];
  unknownRoles: string[];
  changes: {
    name?: { from: string; to: string };
    roles?: { added: string[]; removed: string[] };
  };
  activationToken?: string;
}

interface ImportSummary {
  create: number;
  update: number;
  unchanged: number;
  error: number;
}

const roles = ref<JobRole[]>([]);
const pasteText = ref('');
const plan = ref<PlanRow[] | null>(null);
const summary = ref<ImportSummary | null>(null);
const committed = ref(false);
const previewing = ref(false);
const importing = ref(false);

// Activation links for users created by the last commit — the admin hands these out.
const createdLinks = ref<{ email: string; name: string; url: string }[]>([]);

async function loadRoles(): Promise<void> {
  try {
    const { data } = await client.get<JobRole[]>('/roles');
    roles.value = data;
  } catch {
    toast.error(t('usersImport.toasts.loadRolesError'));
  }
}

function roleName(id: string): string {
  return roles.value.find((r) => r.id === id)?.name ?? id;
}

// Tokenize the clipboard text into rows. Excel paste = tab-separated with an optional header row.
// If a header is present we map columns by name (any order); otherwise we assume Name, Email, Roles.
function parseClipboard(text: string): ParsedRow[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const cells = lines.map((l) => l.split('\t').map((c) => c.trim()));
  const header = cells[0].map((c) => c.toLowerCase());
  const hasHeader = header.some((c) => ['name', 'email', 'e-mail', 'roles', 'role'].includes(c));

  let nameIdx = 0;
  let emailIdx = 1;
  let rolesIdx = 2;
  let dataRows = cells;
  if (hasHeader) {
    const find = (...names: string[]) => header.findIndex((c) => names.includes(c));
    const n = find('name');
    const e = find('email', 'e-mail');
    const r = find('roles', 'role');
    if (n !== -1) nameIdx = n;
    if (e !== -1) emailIdx = e;
    if (r !== -1) rolesIdx = r;
    dataRows = cells.slice(1);
  }

  return dataRows.map((row) => ({
    name: row[nameIdx] ?? '',
    email: row[emailIdx] ?? '',
    roles: (row[rolesIdx] ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean),
  }));
}

const parsedRows = computed(() => parseClipboard(pasteText.value));
const committableCount = computed(() =>
  summary.value ? summary.value.create + summary.value.update : 0,
);

function resetResult(): void {
  plan.value = null;
  summary.value = null;
  committed.value = false;
  createdLinks.value = [];
}

async function pasteFromClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      toast.error(t('usersImport.toasts.clipboardEmpty'));
      return;
    }
    pasteText.value = text;
    await preview();
  } catch {
    toast.error(t('usersImport.toasts.clipboardReadError'));
  }
}

async function send(commit: boolean): Promise<void> {
  const rows = parsedRows.value;
  if (rows.length === 0) {
    toast.error(t('usersImport.toasts.nothingToImport'));
    return;
  }
  const { data } = await client.post<{
    committed: boolean;
    summary: ImportSummary;
    rows: PlanRow[];
  }>('/users/import', { rows, commit });
  plan.value = data.rows;
  summary.value = data.summary;
  committed.value = data.committed;
  createdLinks.value = data.committed
    ? data.rows
        .filter((r) => r.action === 'create' && r.activationToken)
        .map((r) => ({
          email: r.email,
          name: r.name,
          url: `${location.origin}/activate?token=${r.activationToken}`,
        }))
    : [];
}

async function preview(): Promise<void> {
  previewing.value = true;
  try {
    await send(false);
  } catch {
    toast.error(t('usersImport.toasts.previewError'));
  } finally {
    previewing.value = false;
  }
}

async function runImport(): Promise<void> {
  importing.value = true;
  try {
    await send(true);
    const s = summary.value;
    toast.success(t('usersImport.toasts.importedSummary', { created: s?.create ?? 0, updated: s?.update ?? 0 }));
  } catch {
    toast.error(t('usersImport.toasts.importError'));
  } finally {
    importing.value = false;
  }
}

async function copy(text: string, label = t('usersImport.labelLink')): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('usersImport.toasts.copied', { label }));
  } catch {
    toast.error(t('usersImport.toasts.copyError'));
  }
}

function copyAllLinks(): void {
  const text = createdLinks.value.map((l) => `${l.email}\t${l.url}`).join('\n');
  copy(text, t('usersImport.labelAllLinks'));
}

const badgeClass: Record<PlanRow['action'], string> = {
  create: 'bg-pastel-mint/60 text-emerald-700',
  update: 'bg-amber-100 text-amber-700',
  unchanged: 'bg-pastel-slate/50 text-ink-muted',
  error: 'bg-rose-100 text-rose-600',
};

onMounted(loadRoles);
</script>

<template>
  <div>
    <header>
      <RouterLink
        to="/users"
        class="inline-flex items-center gap-1 font-mono text-xs text-ink-light transition hover:text-accent"
      >
        <ArrowLeft class="h-3.5 w-3.5" /> {{ t('usersImport.back') }}
      </RouterLink>
      <h1 class="page-title mt-1">{{ t('usersImport.title') }}</h1>
      <p class="mt-1 font-mono text-xs text-ink-light">
        {{ t('usersImport.subtitle') }}
      </p>
    </header>

    <!-- Paste area -->
    <div class="mt-6 card p-5">
      <div class="flex flex-col gap-1">
        <span class="form-label">{{ t('usersImport.pastedData') }}</span>
        <p class="font-mono text-xs text-ink-light">
          {{ t('usersImport.instructions') }}
        </p>
      </div>
      <textarea
        v-model="pasteText"
        rows="6"
        spellcheck="false"
        class="bg-input mt-2 resize-y"
        placeholder="Name&#9;Email&#9;Roles&#10;Alice Smith&#9;alice@acme.com&#9;Lab Technician&#10;Bob Jones&#9;bob@acme.com&#9;Lab Technician; QA Inspector"
        @input="resetResult"
      />

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <button class="btn-ghost" :disabled="previewing" @click="pasteFromClipboard">
          <ClipboardPaste class="h-4 w-4" /> {{ t('usersImport.pasteFromClipboard') }}
        </button>
        <button
          class="btn-primary"
          :disabled="previewing || parsedRows.length === 0"
          @click="preview"
        >
          <Eye class="h-4 w-4" /> {{ previewing ? t('usersImport.previewing') : t('usersImport.preview') }}
        </button>
        <span class="font-mono text-xs text-ink-light">
          {{ t('usersImport.rowsParsed', { count: parsedRows.length }, parsedRows.length) }}
        </span>
        <div class="flex-1" />
        <span v-if="roles.length" class="font-mono text-[11px] text-ink-light">
          {{ t('usersImport.rolesList', { roles: roles.map((r) => r.name).join(', ') }) }}
        </span>
      </div>
    </div>

    <!-- Preview / result -->
    <template v-if="plan && summary">
      <div class="mt-6 flex flex-wrap items-center gap-2">
        <span class="pill bg-pastel-mint/60 text-emerald-700">{{ t('usersImport.summaryNew', { count: summary.create }) }}</span>
        <span class="pill bg-amber-100 text-amber-700">{{ t('usersImport.summaryUpdated', { count: summary.update }) }}</span>
        <span class="pill bg-pastel-slate/50 text-ink-muted">{{ t('usersImport.summaryUnchanged', { count: summary.unchanged }) }}</span>
        <span v-if="summary.error" class="pill bg-rose-100 text-rose-600">
          <AlertTriangle class="h-3 w-3" /> {{ t('usersImport.summarySkipped', { count: summary.error }) }}
        </span>
        <div class="flex-1" />
        <button
          v-if="!committed"
          class="btn-primary"
          :disabled="importing || committableCount === 0"
          @click="runImport"
        >
          <Upload class="h-4 w-4" />
          {{ importing ? t('usersImport.importing') : t('usersImport.importButton', { count: committableCount }, committableCount) }}
        </button>
        <span v-else class="pill bg-pastel-mint/60 text-emerald-700"><Check class="h-3 w-3" /> {{ t('usersImport.imported') }}</span>
      </div>

      <p v-if="!committed && summary.error" class="mt-2 font-mono text-xs text-rose-600">
        {{ t('usersImport.skippedNote', { count: summary.error }) }}
      </p>

      <div class="mt-3 card overflow-hidden">
        <table class="w-full text-left">
          <thead class="border-b border-line bg-pastel-sky/20">
            <tr class="font-mono text-[11px] uppercase tracking-wide text-ink-light">
              <th class="px-5 py-3">{{ t('usersImport.thStatus') }}</th>
              <th class="px-5 py-3">{{ t('usersImport.thName') }}</th>
              <th class="px-5 py-3">{{ t('usersImport.thEmail') }}</th>
              <th class="px-5 py-3">{{ t('usersImport.thChanges') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in plan" :key="row.index" class="border-b border-line/60 last:border-0">
              <td class="px-5 py-3">
                <span class="pill pill-col" :class="badgeClass[row.action]">{{ t(`usersImport.action${row.action.charAt(0).toUpperCase()}${row.action.slice(1)}`) }}</span>
              </td>
              <td class="px-5 py-3 text-sm font-semibold text-ink">{{ row.name || t('common.none') }}</td>
              <td class="px-5 py-3 font-mono text-xs text-ink-muted">{{ row.email || t('common.none') }}</td>
              <td class="px-5 py-3 font-mono text-xs">
                <!-- error -->
                <span v-if="row.action === 'error'" class="text-rose-600">
                  {{ row.errors.join('; ') }}
                </span>
                <!-- create -->
                <span v-else-if="row.action === 'create'" class="text-ink-light">
                  {{ t('usersImport.changeCreateNew') }}
                  <template v-if="row.matchedRoleIds.length">
                    {{ t('usersImport.changeRoles', { roles: row.matchedRoleIds.map(roleName).join(', ') }) }}
                  </template>
                  <template v-else>{{ t('usersImport.changeNoRoles') }}</template>
                </span>
                <!-- update -->
                <span v-else-if="row.action === 'update'" class="flex flex-col gap-0.5">
                  <span v-if="row.changes.name" class="text-ink-muted">
                    {{ t('usersImport.changeName') }} <span class="text-ink-light line-through">{{ row.changes.name.from }}</span>
                    → <span class="text-ink">{{ row.changes.name.to }}</span>
                  </span>
                  <span v-if="row.changes.roles">
                    <span v-if="row.changes.roles.added.length" class="text-emerald-700">
                      + {{ row.changes.roles.added.join(', ') }}
                    </span>
                    <span v-if="row.changes.roles.removed.length" class="ml-1 text-rose-600">
                      − {{ row.changes.roles.removed.join(', ') }}
                    </span>
                  </span>
                </span>
                <!-- unchanged -->
                <span v-else class="text-ink-light">{{ t('usersImport.changeNoChanges') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Activation links for newly created users -->
      <div v-if="committed && createdLinks.length" class="mt-6 card p-5">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-sans text-base font-bold text-ink">{{ t('usersImport.activationTitle') }}</h2>
            <p class="mt-0.5 font-mono text-xs text-ink-light">
              {{ t('usersImport.activationSubtitle') }}
            </p>
          </div>
          <button class="btn-ghost" @click="copyAllLinks"><Copy class="h-4 w-4" /> {{ t('usersImport.copyAllLinks') }}</button>
        </div>
        <ul class="mt-3 flex flex-col gap-2">
          <li
            v-for="l in createdLinks"
            :key="l.email"
            class="flex items-center gap-3 rounded-md border border-line px-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold text-ink">{{ l.name }}</div>
              <div class="truncate font-mono text-[11px] text-ink-light">{{ l.url }}</div>
            </div>
            <button class="btn-ghost !px-3 !py-1.5" @click="copy(l.url)">
              <Copy class="h-4 w-4" /> {{ t('usersImport.copy') }}
            </button>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.form-label {
  @apply font-sans text-xs font-semibold text-ink-muted;
}
</style>
