<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { Camera, Plus, Save, Trash2, X, ShieldCheck, GraduationCap, Eye, User, UserPlus, Clock, Link2, Mail, UserCheck } from 'lucide-vue-next';
import client from '@/api/client';
import { formatDate } from '@/utils/display';
import { fileToAvatar } from '@/utils/image';
import { useToastStore } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';
import type { JobRole, OrgUnit, SafeUser } from '@/types';
import ListControls from '@/components/ListControls.vue';
import PasswordInput from '@/components/PasswordInput.vue';
import UserAvatar from '@/components/UserAvatar.vue';
import { matchesQuery } from '@/utils/listFilter';

const toast = useToastStore();
const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

interface UserDraft extends SafeUser {
  password?: string;
}

const users = ref<SafeUser[]>([]);
const roles = ref<JobRole[]>([]);
const orgUnits = ref<OrgUnit[]>([]);
const loading = ref(true);
const draft = ref<UserDraft | null>(null);
const isNew = ref(false);
const confirmDelete = ref(false);
const search = ref('');

function accessLabel(u: SafeUser): string {
  return u.isAdmin ? t('users.accessAdmin') : u.isTrainer ? t('users.accessTrainer') : t('users.accessMember');
}

const filteredUsers = computed(() =>
  users.value.filter((u) =>
    matchesQuery(
      search.value,
      u.name,
      u.email,
      orgUnitName(u.orgUnitId),
      roleNames(u.roleIds),
      accessLabel(u),
    ),
  ),
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [u, r, o] = await Promise.all([
      client.get<SafeUser[]>('/users'),
      client.get<JobRole[]>('/roles'),
      client.get<OrgUnit[]>('/org-units'),
    ]);
    // Sort by name so every list and dropdown built from these is alphabetical (fast to scan).
    users.value = u.data.sort((a, b) => a.name.localeCompare(b.name));
    roles.value = r.data.sort((a, b) => a.name.localeCompare(b.name));
    orgUnits.value = o.data.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    loading.value = false;
  }
}

// ── Pending activation (SR-193 / SR-194) ──────────────────────────────────────────────────────────
// What the panel may offer: emailing needs SMTP, activating without a password needs Microsoft SSO.
const smtpReady = ref(false);
const ssoReady = ref(false);
const issuedLink = ref(''); // the link just created for the open account — shown as a copy fallback
const busy = ref(false);

async function loadIntegrations(): Promise<void> {
  const [s, sso] = await Promise.allSettled([
    client.get<{ smtp?: { enabled?: boolean; host?: string; fromAddress?: string } }>('/settings'),
    client.get<{ enabled: boolean }>('/auth/sso/config'),
  ]);
  const m = s.status === 'fulfilled' ? s.value.data.smtp : undefined;
  smtpReady.value = Boolean(m?.enabled && m.host?.trim() && m.fromAddress?.trim());
  ssoReady.value = sso.status === 'fulfilled' && sso.value.data.enabled === true;
}

function linkExpired(u: SafeUser): boolean {
  return !u.activationExpiresAt || Date.parse(u.activationExpiresAt) <= Date.now();
}

const canActivate = computed(
  () => !!draft.value && (!!draft.value.password || !!draft.value.hasPassword || ssoReady.value),
);
const activateHint = computed(() => {
  const d = draft.value;
  if (!d) return '';
  if (d.password) return t('users.activateHintPassword');
  if (d.hasPassword) return t('users.activateHintKeep');
  return ssoReady.value ? t('users.activateHintSso') : t('users.activateHintNeedPassword');
});

/** Mirror a change onto the list row, so the badge is right without a reload. */
function syncRow(id: string, patch: Partial<SafeUser>): void {
  const row = users.value.find((u) => u.id === id);
  if (row) Object.assign(row, patch);
}

const apiError = (e: unknown, fallback: string): string =>
  (axios.isAxiosError(e) && typeof e.response?.data?.error === 'string' && e.response.data.error) || fallback;

async function copyActivationLink(): Promise<void> {
  const d = draft.value;
  if (!d?.id) return;
  busy.value = true;
  try {
    const { data } = await client.post<{ activationToken: string; expiresAt: string }>(`/users/${d.id}/activation-link`);
    issuedLink.value = `${location.origin}/activate?token=${data.activationToken}`;
    d.activationExpiresAt = data.expiresAt;
    syncRow(d.id, { activationExpiresAt: data.expiresAt });
    try {
      await navigator.clipboard.writeText(issuedLink.value);
      toast.success(t('users.toasts.linkCopied'));
    } catch {
      toast.success(t('users.toasts.linkCreated')); // clipboard blocked — the link is shown in the panel
    }
  } catch {
    toast.error(t('users.toasts.linkError'));
  } finally {
    busy.value = false;
  }
}

async function emailActivationLink(): Promise<void> {
  const d = draft.value;
  if (!d?.id) return;
  busy.value = true;
  try {
    const { data } = await client.post<{ sentTo: string; expiresAt: string }>(`/users/${d.id}/activation-email`);
    issuedLink.value = ''; // a link shown earlier was just replaced — it no longer works
    d.activationExpiresAt = data.expiresAt;
    syncRow(d.id, { activationExpiresAt: data.expiresAt });
    toast.success(t('users.toasts.linkSent', { email: data.sentTo }));
  } catch (e) {
    toast.error(apiError(e, t('users.toasts.sendError')));
  } finally {
    busy.value = false;
  }
}

async function activateNow(): Promise<void> {
  const d = draft.value;
  if (!d?.id) return;
  busy.value = true;
  try {
    await client.post(`/users/${d.id}/activate`, d.password ? { password: d.password } : {});
    toast.success(t('users.toasts.activated'));
    close();
    await load();
  } catch (e) {
    toast.error(apiError(e, t('users.toasts.activateError')));
  } finally {
    busy.value = false;
  }
}

function roleNames(ids: string[]): string {
  return (
    ids
      .map((id) => roles.value.find((r) => r.id === id)?.name)
      .filter((n): n is string => Boolean(n))
      .sort((a, b) => a.localeCompare(b))
      .join(', ') || t('common.none')
  );
}

function orgUnitName(id: string | undefined): string {
  return orgUnits.value.find((o) => o.id === id)?.name ?? t('common.none');
}

function openNew(): void {
  const root = orgUnits.value.find((o) => o.parentId === null) ?? orgUnits.value[0];
  draft.value = {
    id: '',
    name: '',
    email: '',
    roleIds: [],
    orgUnitId: root?.id ?? '',
    isAdmin: false,
    isTrainer: false,
    createdAt: '',
    password: '',
  };
  isNew.value = true;
  confirmDelete.value = false;
}
// The row whose dialog was opened last — kept marked in the table after the dialog closes, so the
// user sees where they were when they come back.
const lastOpenedId = ref<string | null>(null);

function openEdit(u: SafeUser): void {
  lastOpenedId.value = u.id;
  draft.value = { ...JSON.parse(JSON.stringify(u)), password: '' };
  issuedLink.value = '';
  isNew.value = false;
  confirmDelete.value = false;
}
function close(): void {
  draft.value = null;
}

// Profile picture in the editor: cropped and downscaled in the browser, sent with Save.
const avatarInput = ref<HTMLInputElement | null>(null);
async function onAvatarPick(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // picking the same file again must fire change again
  if (!file || !draft.value) return;
  try {
    draft.value.avatar = await fileToAvatar(file);
  } catch {
    toast.error(t('nav.avatarError'));
  }
}

// Close the edit dialog on Escape (the dialog has no always-focused element to bind to).
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && draft.value) close();
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
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
  if (!d.orgUnitId) {
    toast.error(t('users.toasts.orgUnitRequired'));
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
      // A password saved for a pending account activates it (the server does that).
      toast.success(d.isDisabled && d.password ? t('users.toasts.activated') : t('users.toasts.updated'));
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
onMounted(loadIntegrations);
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

    <div v-else class="mt-6">
      <ListControls
        v-model:query="search"
        :count="filteredUsers.length"
        :total="users.length"
      />
      <div class="card overflow-hidden">
      <table class="w-full text-left">
        <thead class="border-b border-line bg-pastel-sky/20">
          <tr class="font-mono text-[11px] uppercase tracking-wide text-ink-light">
            <th class="px-5 py-3">{{ t('users.thName') }}</th>
            <th class="px-5 py-3">{{ t('users.thEmail') }}</th>
            <th class="hidden px-5 py-3 lg:table-cell">{{ t('users.thOrgUnit') }}</th>
            <th class="hidden px-5 py-3 md:table-cell">{{ t('users.thRoles') }}</th>
            <th class="px-5 py-3">{{ t('users.thAccess') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in filteredUsers"
            :key="u.id"
            class="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-pastel-sky/20"
            :class="lastOpenedId === u.id ? 'bg-accent-light/20' : ''"
            :data-selected="lastOpenedId === u.id ? 'true' : undefined"
            @click="openEdit(u)"
          >
            <td class="px-5 py-3 text-sm font-semibold text-ink">
              <div class="flex items-center gap-2.5">
                <UserAvatar :name="u.name" :avatar="u.avatar" size="xs" class="bg-petrol-400" />
                <span>
                  {{ u.name }}
                  <span
                    v-if="u.isDisabled"
                    class="pill pill-col ml-2 bg-amber-100 text-amber-700"
                    data-testid="user-pending-badge"
                  >
                    <Clock class="h-3 w-3" /> {{ linkExpired(u) ? t('users.linkExpired') : t('users.pending') }}
                  </span>
                </span>
              </div>
            </td>
            <td class="px-5 py-3 font-mono text-xs text-ink-muted">{{ u.email }}</td>
            <td class="hidden px-5 py-3 font-mono text-xs text-ink-light lg:table-cell">
              {{ orgUnitName(u.orgUnitId) }}
            </td>
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
              <span v-else class="pill pill-col bg-pastel-slate/50 text-ink-muted">
                <User class="h-3 w-3" /> {{ t('users.accessMember') }}
              </span>
            </td>
          </tr>
          <tr v-if="filteredUsers.length === 0">
            <td colspan="5" class="px-5 py-6 text-center font-mono text-xs text-ink-light">{{ t('common.noMatches') }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <!-- Editor dialog (a plain centered modal, like the training editor; no slide-in transition,
         so tests and users get a deterministic mount). -->
      <div v-if="draft" class="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-ink/40" @click="close" />
        <div
          class="relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-lift"
          role="dialog"
          aria-modal="true"
          :aria-label="isNew ? t('users.new') : t('users.edit')"
        >
          <div class="flex items-center justify-between border-b border-line px-5 py-3">
            <!-- The title names WHO is being edited (live while typing); "Edit user" only covers a
                 blank name. New accounts keep the generic "New user". -->
            <h2 class="min-w-0 truncate font-sans text-base font-bold text-ink">
              {{ isNew ? t('users.new') : draft.name || t('users.edit') }}
            </h2>
            <button class="ml-3 shrink-0 text-ink-light hover:text-ink" :aria-label="t('common.close')" @click="close"><X class="h-5 w-5" /></button>
          </div>

          <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          <!-- Profile picture — saved with the form. Existing accounts only: a new one gets it later. -->
          <div v-if="!isNew" class="flex items-center gap-3">
            <UserAvatar :name="draft.name || '?'" :avatar="draft.avatar" size="lg" class="bg-petrol-400" />
            <div class="flex flex-col gap-1">
              <span class="form-label">{{ t('users.avatar') }}</span>
              <div class="flex gap-2">
                <button type="button" class="btn-ghost btn-sm" data-testid="user-avatar-change" @click="avatarInput?.click()">
                  <Camera class="h-3.5 w-3.5" /> {{ t('nav.avatarChange') }}
                </button>
                <button
                  v-if="draft.avatar"
                  type="button"
                  class="btn-ghost btn-sm"
                  data-testid="user-avatar-remove"
                  @click="draft.avatar = null"
                >
                  <Trash2 class="h-3.5 w-3.5" /> {{ t('nav.avatarRemove') }}
                </button>
              </div>
              <input ref="avatarInput" type="file" accept="image/*" class="hidden" data-testid="user-avatar-input" @change="onAvatarPick" />
            </div>
          </div>
          <!-- Identity fields in a two-column grid — the wide dialog keeps the form flat. -->
          <div class="grid gap-4 sm:grid-cols-2">
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
            <PasswordInput v-model="draft.password" autocomplete="new-password" />
            <span v-if="!isNew && draft.isDisabled" class="font-mono text-[11px] text-amber-700">
              {{ t('users.passwordActivates') }}
            </span>
          </label>

          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('users.orgUnit') }}</span>
            <select v-model="draft.orgUnitId" class="bg-input">
              <option v-for="o in orgUnits" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </label>
          </div>

          <!-- Pending activation: the account cannot sign in yet. Copy or email a NEW link (the old one
               dies), or enable the account directly. -->
          <section
            v-if="!isNew && draft.isDisabled"
            class="rounded-lg border border-amber-200 bg-amber-50 p-4"
            data-testid="pending-panel"
          >
            <div class="flex items-center gap-2 text-sm font-semibold text-amber-800">
              <Clock class="h-4 w-4" /> {{ t('users.pendingTitle') }}
            </div>
            <p class="mt-1 font-mono text-xs text-amber-800">
              {{ t('users.pendingText') }}
              {{
                !draft.activationExpiresAt
                  ? t('users.pendingNoLink')
                  : linkExpired(draft)
                    ? t('users.pendingLinkExpired', { date: formatDate(draft.activationExpiresAt) })
                    : t('users.pendingLinkValid', { date: formatDate(draft.activationExpiresAt) })
              }}
            </p>
            <p class="mt-1 font-mono text-[11px] text-amber-700">{{ t('users.pendingRevokeNote') }}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button class="btn-ghost btn-sm" :disabled="busy" data-testid="pending-copy-link" @click="copyActivationLink">
                <Link2 class="h-4 w-4" /> {{ t('users.copyLink') }}
              </button>
              <button
                class="btn-ghost btn-sm"
                :disabled="busy || !smtpReady"
                :title="smtpReady ? undefined : t('users.smtpMissing')"
                data-testid="pending-send-link"
                @click="emailActivationLink"
              >
                <Mail class="h-4 w-4" /> {{ t('users.sendLink') }}
              </button>
              <button
                class="btn-primary btn-sm"
                :disabled="busy || !canActivate"
                data-testid="pending-activate"
                @click="activateNow"
              >
                <UserCheck class="h-4 w-4" /> {{ t('users.activateNow') }}
              </button>
            </div>
            <p v-if="!smtpReady" class="mt-2 font-mono text-[11px] text-ink-light">{{ t('users.smtpMissing') }}</p>
            <p class="mt-1 font-mono text-[11px] text-ink-light" data-testid="pending-activate-hint">{{ activateHint }}</p>
            <label v-if="issuedLink" class="mt-3 flex flex-col gap-1">
              <span class="form-label">{{ t('users.linkLabel') }}</span>
              <input
                :value="issuedLink"
                readonly
                class="bg-input font-mono text-xs"
                data-testid="pending-link"
                @focus="($event.target as HTMLInputElement).select()"
              />
            </label>
          </section>

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
            <!-- Roles as a checkbox grid — many roles stay scannable without scrolling. -->
            <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label
                v-for="r in roles"
                :key="r.id"
                class="check-card"
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
          </div>

          <div class="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
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
                <button class="btn-danger btn-sm" @click="remove">{{ t('users.deleteYes') }}</button>
                <button class="btn-ghost btn-sm" @click="confirmDelete = false">{{ t('users.deleteNo') }}</button>
              </template>
              <button v-else class="btn-danger btn-sm" @click="confirmDelete = true">
                <Trash2 class="h-4 w-4" /> {{ t('common.delete') }}
              </button>
            </template>
          </div>
        </div>
      </div>
  </div>
</template>
