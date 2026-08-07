<script setup lang="ts">
// Admin-only backup management: snapshot all app data, download one or all archives, upload an archive
// produced elsewhere, restore any listed backup (replacing all data), and delete backups.
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Archive,
  Download,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  ShieldAlert,
} from 'lucide-vue-next';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import type { BackupMeta } from '@/types';
import { formatBytes, formatDate } from '@/utils/display';
import { apiErrorMessage, downloadFile } from '@/utils/download';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const backups = ref<BackupMeta[]>([]);
const loading = ref(true);
const creating = ref(false);
const uploading = ref(false);
const bundling = ref(false);
const restoringId = ref<string | null>(null);
// At most one confirmation is ever open, so it is one piece of state rather than two exclusive refs.
const confirming = ref<{ id: string; action: 'restore' | 'delete' } | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const totalSize = computed(() => backups.value.reduce((n, b) => n + b.size, 0));
const isConfirming = (id: string, action: 'restore' | 'delete'): boolean =>
  confirming.value?.id === id && confirming.value.action === action;

async function load(): Promise<void> {
  // Only show the skeleton on the initial load — refreshes after an action keep the table visible.
  loading.value = backups.value.length === 0;
  try {
    const { data } = await client.get<BackupMeta[]>('/backups');
    backups.value = data;
  } catch {
    toast.error(t('backups.toasts.loadError'));
  } finally {
    loading.value = false;
  }
}

async function createBackup(): Promise<void> {
  creating.value = true;
  try {
    await client.post<BackupMeta>('/backups');
    toast.success(t('backups.toasts.created'));
    await load();
  } catch (err) {
    toast.error((await apiErrorMessage(err)) || t('backups.toasts.createError'));
  } finally {
    creating.value = false;
  }
}

async function download(backup: BackupMeta): Promise<void> {
  try {
    await downloadFile(`/backups/${backup.id}/download`, backup.fileName);
  } catch (err) {
    toast.error((await apiErrorMessage(err)) || t('backups.toasts.downloadError'));
  }
}

async function downloadAll(): Promise<void> {
  bundling.value = true;
  try {
    // The server names the bundle (Content-Disposition); this fallback only applies if it doesn't.
    await downloadFile('/backups/download-all', 'braingain-backups.zip');
  } catch (err) {
    toast.error((await apiErrorMessage(err)) || t('backups.toasts.downloadAllError'));
  } finally {
    bundling.value = false;
  }
}

function pickFile(): void {
  fileInput.value?.click();
}

async function onFilePicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // reset so picking the same file again still fires change
  if (!file) return;
  uploading.value = true;
  try {
    // Raw octet-stream body so the archive bypasses the JSON body parser (as material uploads do).
    await client.post<BackupMeta>('/backups/upload', file, {
      params: { name: file.name },
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    toast.success(t('backups.toasts.uploaded', { name: file.name }));
    await load();
  } catch (err) {
    toast.error((await apiErrorMessage(err)) || t('backups.toasts.uploadError'));
  } finally {
    uploading.value = false;
  }
}

async function restore(backup: BackupMeta): Promise<void> {
  restoringId.value = backup.id;
  try {
    await client.post(`/backups/${backup.id}/restore`);
    confirming.value = null;
    toast.success(t('backups.toasts.restored'));
    await load();
    // The restored dataset may not contain the signed-in admin, in which case this session's identity
    // no longer resolves — verify it and send them to the login page rather than a broken app.
    try {
      await auth.fetchMe();
    } catch {
      toast.error(t('backups.toasts.reloginNeeded'));
      auth.logout();
      window.location.assign('/login');
    }
  } catch (err) {
    toast.error((await apiErrorMessage(err)) || t('backups.toasts.restoreError'));
  } finally {
    restoringId.value = null;
  }
}

async function remove(backup: BackupMeta): Promise<void> {
  try {
    await client.delete(`/backups/${backup.id}`);
    confirming.value = null;
    toast.success(t('backups.toasts.deleted'));
    await load();
  } catch (err) {
    toast.error((await apiErrorMessage(err)) || t('backups.toasts.deleteError'));
  }
}

// Record rather than ternaries: a new BackupSource becomes a compile error instead of silently
// rendering as "manual".
const SOURCE: Record<BackupMeta['source'], { key: string; cls: string }> = {
  manual: { key: 'backups.sourceManual', cls: 'bg-pastel-mint/60 text-emerald-700' },
  'pre-restore': { key: 'backups.sourcePreRestore', cls: 'bg-amber-100 text-amber-700' },
  upload: { key: 'backups.sourceUpload', cls: 'bg-pastel-blue/50 text-ink' },
};

onMounted(load);
</script>

<template>
  <div>
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="page-title">{{ t('backups.title') }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">
          {{ t('backups.subtitle', { count: backups.length, size: formatBytes(totalSize) }) }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn-primary" :disabled="creating" @click="createBackup">
          <Loader2 v-if="creating" class="h-4 w-4 animate-spin" />
          <Plus v-else class="h-4 w-4" />
          {{ creating ? t('backups.creating') : t('backups.create') }}
        </button>
        <button class="btn-ghost" :disabled="uploading" @click="pickFile">
          <Loader2 v-if="uploading" class="h-4 w-4 animate-spin" />
          <Upload v-else class="h-4 w-4" />
          {{ uploading ? t('backups.uploading') : t('backups.upload') }}
        </button>
        <button class="btn-ghost" :disabled="bundling || backups.length === 0" @click="downloadAll">
          <Loader2 v-if="bundling" class="h-4 w-4 animate-spin" />
          <Download v-else class="h-4 w-4" />
          {{ t('backups.downloadAll') }}
        </button>
        <input ref="fileInput" type="file" accept=".zip" class="hidden" @change="onFilePicked" />
      </div>
    </header>

    <!-- What a backup holds, and what it does not -->
    <div class="mt-5 card flex items-start gap-3 border-amber-200 bg-amber-50/60 p-4">
      <ShieldAlert class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <p class="font-mono text-xs leading-relaxed text-ink-muted">{{ t('backups.notice') }}</p>
    </div>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 3" :key="n" class="card h-14 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else class="mt-6 card overflow-hidden">
      <table class="w-full text-left">
        <thead class="border-b border-line bg-pastel-sky/20">
          <tr class="font-mono text-[11px] uppercase tracking-wide text-ink-light">
            <th class="px-5 py-3">{{ t('backups.thName') }}</th>
            <th class="hidden px-5 py-3 md:table-cell">{{ t('backups.thCreated') }}</th>
            <th class="px-5 py-3">{{ t('backups.thSize') }}</th>
            <th class="hidden px-5 py-3 lg:table-cell">{{ t('backups.thContents') }}</th>
            <th class="px-5 py-3">{{ t('backups.thSource') }}</th>
            <th class="px-5 py-3 text-right">{{ t('backups.thActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in backups" :key="b.id" class="border-b border-line/60 last:border-0">
            <td class="px-5 py-3">
              <span class="flex items-center gap-2">
                <Archive class="h-4 w-4 shrink-0 text-ink-light" />
                <span class="font-mono text-xs font-semibold text-ink">{{ b.fileName }}</span>
              </span>
            </td>
            <td class="hidden px-5 py-3 font-mono text-xs text-ink-muted md:table-cell">{{ formatDate(b.createdAt) }}</td>
            <td class="px-5 py-3 font-mono text-xs text-ink-muted">{{ formatBytes(b.size) }}</td>
            <td class="hidden px-5 py-3 font-mono text-[11px] text-ink-light lg:table-cell">
              {{ t('backups.contents', { users: b.contents.users, trainings: b.contents.trainings, materials: b.contents.materials }) }}
            </td>
            <td class="px-5 py-3">
              <span class="pill" :class="SOURCE[b.source].cls">{{ t(SOURCE[b.source].key) }}</span>
            </td>
            <td class="px-5 py-3">
              <!-- Restore and delete are destructive: each asks for confirmation in place. -->
              <div v-if="isConfirming(b.id, 'restore')" class="flex flex-wrap items-center justify-end gap-2">
                <span class="font-mono text-[11px] text-amber-700">{{ t('backups.restoreConfirm') }}</span>
                <button class="btn-danger btn-sm" :disabled="restoringId === b.id" @click="restore(b)">
                  <Loader2 v-if="restoringId === b.id" class="h-3.5 w-3.5 animate-spin" />
                  {{ restoringId === b.id ? t('backups.restoring') : t('backups.restoreYes') }}
                </button>
                <button class="btn-ghost btn-sm" :disabled="restoringId === b.id" @click="confirming = null">{{ t('common.cancel') }}</button>
              </div>
              <div v-else-if="isConfirming(b.id, 'delete')" class="flex flex-wrap items-center justify-end gap-2">
                <span class="font-mono text-[11px] text-rose-600">{{ t('backups.deleteConfirm') }}</span>
                <button class="btn-danger btn-sm" @click="remove(b)">{{ t('backups.deleteYes') }}</button>
                <button class="btn-ghost btn-sm" @click="confirming = null">{{ t('common.no') }}</button>
              </div>
              <div v-else class="flex items-center justify-end gap-1">
                <button class="btn-ghost btn-sm" :title="t('backups.download')" @click="download(b)">
                  <Download class="h-4 w-4" /> {{ t('backups.download') }}
                </button>
                <button class="btn-ghost btn-sm" :title="t('backups.restore')" @click="confirming = { id: b.id, action: 'restore' }">
                  <RotateCcw class="h-4 w-4" /> {{ t('backups.restore') }}
                </button>
                <button class="btn-ghost btn-sm !text-rose-600" :title="t('common.delete')" @click="confirming = { id: b.id, action: 'delete' }">
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="backups.length === 0">
            <td colspan="6" class="px-5 py-8 text-center font-mono text-xs text-ink-light">{{ t('backups.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
