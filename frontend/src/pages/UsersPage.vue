<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Plus, Save, Trash2, X, ShieldCheck, GraduationCap, Eye, UserPlus } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';
import type { JobRole, SafeUser } from '@/types';

const toast = useToastStore();
const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

interface UserDraft extends SafeUser {
  password?: string;
}

const users = ref<SafeUser[]>([]);
const roles = ref<JobRole[]>([]);
const loading = ref(true);
const draft = ref<UserDraft | null>(null);
const isNew = ref(false);
const confirmDelete = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [u, r] = await Promise.all([
      client.get<SafeUser[]>('/users'),
      client.get<JobRole[]>('/roles'),
    ]);
    users.value = u.data;
    roles.value = r.data;
  } finally {
    loading.value = false;
  }
}

function roleNames(ids: string[]): string {
  return ids.map((id) => roles.value.find((r) => r.id === id)?.name).filter(Boolean).join(', ') || t('common.none');
}

function openNew(): void {
  draft.value = {
    id: '',
    name: '',
    email: '',
    roleIds: [],
    isAdmin: false,
    isTrainer: false,
    createdAt: '',
    password: '',
  };
  isNew.value = true;
  confirmDelete.value = false;
}
function openEdit(u: SafeUser): void {
  draft.value = { ...JSON.parse(JSON.stringify(u)), password: '' };
  isNew.value = false;
  confirmDelete.value = false;
}
function close(): void {
  draft.value = null;
}
function toggleRole(id: string): void {
  if (!draft.value) return;
  const i = draft.value.roleIds.indexOf(id);
  if (i === -1) draft.value.roleIds.push(id);
  else draft.value.roleIds.splice(i, 1);
}

async function save(): Promise<void> {
  if (!draft.value) return;
  const d = draft.value;
  if (!d.name.trim() || !d.email.trim()) {
    toast.error(t('users.toasts.nameEmailRequired'));
    return;
  }
  if (isNew.value && !d.password) {
    toast.error(t('users.toasts.passwordRequired'));
    return;
  }
  try {
    if (isNew.value) {
      await client.post('/users', d);
      toast.success(t('users.toasts.created'));
    } else {
      await client.put(`/users/${d.id}`, d);
      toast.success(t('users.toasts.updated'));
    }
    close();
    await load();
  } catch {
    toast.error(t('users.toasts.saveError'));
  }
}

// Start a "view as" session for the user being edited, then jump to their dashboard.
async function impersonate(): Promise<void> {
  if (!draft.value?.id) return;
  try {
    await auth.startImpersonation(draft.value.id);
    close();
    await router.push('/dashboard');
  } catch {
    toast.error(t('users.toasts.impersonateError'));
  }
}

async function remove(): Promise<void> {
  if (!draft.value?.id) return;
  try {
    await client.delete(`/users/${draft.value.id}`);
    toast.success(t('users.toasts.deleted'));
    close();
    await load();
  } catch {
    toast.error(t('users.toasts.deleteError'));
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="flex items-center justify-between">
      <div>
        <h1 class="page-title">{{ t('users.title') }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">{{ t('users.subtitle', { count: users.length }) }}</p>
      </div>
      <div class="flex items-center gap-2">
        <RouterLink to="/users/import" class="btn-ghost"><UserPlus class="h-4 w-4" /> {{ t('users.import') }}</RouterLink>
        <button class="btn-primary" @click="openNew"><Plus class="h-4 w-4" /> {{ t('users.add') }}</button>
      </div>
    </header>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 4" :key="n" class="card h-14 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else class="mt-6 card overflow-hidden">
      <table class="w-full text-left">
        <thead class="border-b border-line bg-pastel-sky/20">
          <tr class="font-mono text-[11px] uppercase tracking-wide text-ink-light">
            <th class="px-5 py-3">{{ t('users.thName') }}</th>
            <th class="px-5 py-3">{{ t('users.thEmail') }}</th>
            <th class="hidden px-5 py-3 md:table-cell">{{ t('users.thRoles') }}</th>
            <th class="px-5 py-3">{{ t('users.thAccess') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in users"
            :key="u.id"
            class="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-pastel-sky/20"
            @click="openEdit(u)"
          >
            <td class="px-5 py-3 text-sm font-semibold text-ink">{{ u.name }}</td>
            <td class="px-5 py-3 font-mono text-xs text-ink-muted">{{ u.email }}</td>
            <td class="hidden px-5 py-3 font-mono text-xs text-ink-light md:table-cell">
              {{ roleNames(u.roleIds) }}
            </td>
            <td class="px-5 py-3">
              <span v-if="u.isAdmin" class="pill pill-col bg-accent-light/60 text-accent">
                <ShieldCheck class="h-3 w-3" /> {{ t('users.accessAdmin') }}
              </span>
              <span v-else-if="u.isTrainer" class="pill pill-col bg-pastel-mint/50 text-emerald-700">
                <GraduationCap class="h-3 w-3" /> {{ t('users.accessTrainer') }}
              </span>
              <span v-else class="pill pill-col bg-pastel-slate/50 text-ink-muted">{{ t('users.accessMember') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Drawer -->
    <Transition name="fade-slide">
      <div v-if="draft" class="fixed inset-0 z-40 flex justify-end" @click.self="close">
        <div class="absolute inset-0 bg-ink/20" @click="close" />
        <div class="relative z-10 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-6 shadow-lift">
          <div class="flex items-center justify-between">
            <h2 class="font-sans text-lg font-bold text-ink">{{ isNew ? t('users.new') : t('users.edit') }}</h2>
            <button class="text-ink-light hover:text-ink" @click="close"><X class="h-5 w-5" /></button>
          </div>

          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('common.name') }}</span>
            <input v-model="draft.name" class="bg-input" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('common.email') }}</span>
            <input v-model="draft.email" type="email" class="bg-input" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ isNew ? t('users.passwordNew') : t('users.passwordEdit') }}</span>
            <input v-model="draft.password" type="password" class="bg-input" autocomplete="new-password" />
          </label>

          <div class="flex gap-4">
            <label class="flex items-center gap-2 font-mono text-sm text-ink-muted">
              <input v-model="draft.isAdmin" type="checkbox" class="accent-accent" /> {{ t('users.admin') }}
            </label>
            <label class="flex items-center gap-2 font-mono text-sm text-ink-muted">
              <input v-model="draft.isTrainer" type="checkbox" class="accent-accent" /> {{ t('users.trainer') }}
            </label>
          </div>

          <div>
            <span class="form-label">{{ t('users.jobRoles') }}</span>
            <div class="mt-2 flex flex-col gap-2">
              <label
                v-for="r in roles"
                :key="r.id"
                class="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 font-mono text-sm transition hover:bg-pastel-sky/30"
                :class="draft.roleIds.includes(r.id) ? 'border-accent bg-accent-light/30' : ''"
              >
                <input
                  type="checkbox"
                  class="accent-accent"
                  :checked="draft.roleIds.includes(r.id)"
                  @change="toggleRole(r.id)"
                />
                {{ r.name }}
              </label>
              <p v-if="roles.length === 0" class="font-mono text-xs text-ink-light">{{ t('users.noRoles') }}</p>
            </div>
          </div>

          <div class="mt-auto flex items-center gap-2 pt-4">
            <button class="btn-primary" @click="save"><Save class="h-4 w-4" /> {{ t('users.save') }}</button>
            <button
              v-if="!isNew && draft.id !== auth.user?.id"
              class="btn-ghost"
              :title="t('users.viewAsTitle')"
              @click="impersonate"
            >
              <Eye class="h-4 w-4" /> {{ t('users.viewAs') }}
            </button>
            <div class="flex-1" />
            <template v-if="!isNew">
              <template v-if="confirmDelete">
                <span class="font-mono text-xs text-rose-600">{{ t('users.deleteConfirm') }}</span>
                <button class="btn-danger !px-3 !py-1.5" @click="remove">{{ t('users.deleteYes') }}</button>
                <button class="btn-ghost !px-3 !py-1.5" @click="confirmDelete = false">{{ t('users.deleteNo') }}</button>
              </template>
              <button v-else class="btn-danger !px-3 !py-1.5" @click="confirmDelete = true">
                <Trash2 class="h-4 w-4" /> {{ t('common.delete') }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.form-label {
  @apply font-sans text-xs font-semibold text-ink-muted;
}
</style>
