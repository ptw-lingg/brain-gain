<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, Plus, Save, Trash2, UserPlus, X } from 'lucide-vue-next';
import axios from 'axios';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { OrgUnit, SafeUser } from '@/types';
import ListControls from '@/components/ListControls.vue';
import { matchesQuery } from '@/utils/listFilter';

const toast = useToastStore();
const { t } = useI18n();

const units = ref<OrgUnit[]>([]);
const users = ref<SafeUser[]>([]);
const loading = ref(true);
const expandedId = ref<string | null>(null);
const draft = ref<OrgUnit | null>(null);
const confirmDeleteId = ref<string | null>(null);
const search = ref('');

// Bulk "add members" picker (scoped to the currently-open unit).
const addMembersOpen = ref(false);
const memberQuery = ref('');
const selectedMemberIds = ref<string[]>([]);

function resetMemberPicker(): void {
  addMembersOpen.value = false;
  memberQuery.value = '';
  selectedMemberIds.value = [];
}

/** Users not already in the open unit, filtered by the search box. */
const memberCandidates = computed<SafeUser[]>(() => {
  if (!draft.value?.id) return [];
  const unitId = draft.value.id;
  const q = memberQuery.value.trim().toLowerCase();
  return users.value.filter(
    (us) =>
      us.orgUnitId !== unitId &&
      (!q || us.name.toLowerCase().includes(q) || us.email.toLowerCase().includes(q)),
  );
});

function toggleMember(id: string): void {
  const i = selectedMemberIds.value.indexOf(id);
  if (i === -1) selectedMemberIds.value.push(id);
  else selectedMemberIds.value.splice(i, 1);
}

async function addMembers(): Promise<void> {
  if (!draft.value?.id || selectedMemberIds.value.length === 0) return;
  try {
    const { data } = await client.post<{ moved: number }>(
      `/org-units/${draft.value.id}/members`,
      { userIds: selectedMemberIds.value },
    );
    toast.success(t('orgUnits.toasts.membersAdded', { count: data.moved }, data.moved));
    resetMemberPicker();
    await load();
  } catch (e: unknown) {
    const msg = axios.isAxiosError(e) ? e.response?.data?.error : '';
    toast.error(msg || t('orgUnits.toasts.membersError'));
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [o, u] = await Promise.all([
      client.get<OrgUnit[]>('/org-units'),
      client.get<SafeUser[]>('/users'),
    ]);
    // Sort by name so the parent/head dropdowns and member picker are alphabetical (the unit list
    // itself is re-ordered into a tree by `ordered`).
    units.value = o.data.sort((a, b) => a.name.localeCompare(b.name));
    users.value = u.data.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    loading.value = false;
  }
}

const isRoot = (u: OrgUnit): boolean => u.parentId === null;
const depthOf = (u: OrgUnit): number => {
  let d = 0;
  let cur: OrgUnit | undefined = u;
  const byId = new Map(units.value.map((x) => [x.id, x] as const));
  while (cur && cur.parentId) {
    cur = byId.get(cur.parentId);
    d += 1;
    if (d > 20) break; // guard against any malformed cycle
  }
  return d;
};

/** Units in tree order (depth-first from roots) so indentation reads as a hierarchy. */
const ordered = computed<OrgUnit[]>(() => {
  const byParent = new Map<string | null, OrgUnit[]>();
  for (const u of units.value) {
    const key = u.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(u);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const out: OrgUnit[] = [];
  const walk = (parentId: string | null): void => {
    for (const u of byParent.get(parentId) ?? []) {
      out.push(u);
      walk(u.id);
    }
  };
  walk(null);
  // Append any orphans (parent missing) so nothing is hidden.
  for (const u of units.value) if (!out.includes(u)) out.push(u);
  return out;
});

const memberCount = (unitId: string): number =>
  users.value.filter((u) => u.orgUnitId === unitId).length;
const unitName = (id: string | null): string =>
  id ? (units.value.find((u) => u.id === id)?.name ?? t('common.none')) : t('common.none');
const headName = (id: string): string =>
  users.value.find((u) => u.id === id)?.name ?? t('common.none');

/** Units (in tree order) matching the search box; depth is still computed from the full tree. */
const filteredUnits = computed<OrgUnit[]>(() =>
  ordered.value.filter((u) => matchesQuery(search.value, u.name, u.headUserId ? headName(u.headUserId) : '')),
);

/** Descendants of a unit (ids) — excluded from the parent picker to prevent cycles. */
const descendantIds = (unitId: string): Set<string> => {
  const result = new Set<string>();
  const walk = (id: string): void => {
    for (const u of units.value) {
      if (u.parentId === id && !result.has(u.id)) {
        result.add(u.id);
        walk(u.id);
      }
    }
  };
  walk(unitId);
  return result;
};

const parentOptions = computed<OrgUnit[]>(() => {
  if (!draft.value) return [];
  const exclude = draft.value.id ? new Set([draft.value.id, ...descendantIds(draft.value.id)]) : new Set<string>();
  return units.value.filter((u) => !exclude.has(u.id));
});

function startCreate(): void {
  const root = units.value.find(isRoot) ?? null;
  draft.value = { id: '', name: '', parentId: root?.id ?? null, headUserId: '' };
  expandedId.value = '__new__';
}
function startEdit(u: OrgUnit): void {
  draft.value = JSON.parse(JSON.stringify(u));
  expandedId.value = u.id;
  confirmDeleteId.value = null;
  resetMemberPicker();
}
function cancel(): void {
  draft.value = null;
  expandedId.value = null;
  resetMemberPicker();
}

async function save(): Promise<void> {
  if (!draft.value) return;
  if (!draft.value.name.trim()) {
    toast.error(t('orgUnits.toasts.nameRequired'));
    return;
  }
  const body = {
    name: draft.value.name,
    parentId: draft.value.parentId,
    headUserId: draft.value.headUserId,
  };
  try {
    if (draft.value.id) {
      await client.put(`/org-units/${draft.value.id}`, body);
      toast.success(t('orgUnits.toasts.updated'));
    } else {
      await client.post('/org-units', body);
      toast.success(t('orgUnits.toasts.created'));
    }
    cancel();
    await load();
  } catch (e: unknown) {
    const msg = axios.isAxiosError(e) ? e.response?.data?.error : '';
    toast.error(msg || t('orgUnits.toasts.saveError'));
  }
}

async function remove(id: string): Promise<void> {
  try {
    await client.delete(`/org-units/${id}`);
    toast.success(t('orgUnits.toasts.deleted'));
    confirmDeleteId.value = null;
    if (expandedId.value === id) cancel();
    await load();
  } catch (e: unknown) {
    const msg = axios.isAxiosError(e) ? e.response?.data?.error : '';
    toast.error(msg || t('orgUnits.toasts.deleteError'));
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="flex items-center justify-between">
      <div>
        <h1 class="page-title">{{ t('orgUnits.title') }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">{{ t('orgUnits.subtitle', { count: units.length }) }}</p>
      </div>
      <button class="btn-primary" @click="startCreate"><Plus class="h-4 w-4" /> {{ t('orgUnits.add') }}</button>
    </header>

    <!-- New unit editor -->
    <div v-if="expandedId === '__new__' && draft" class="mt-6 card border-accent/40 p-5">
      <h3 class="mb-3 font-sans text-sm font-bold text-accent">{{ t('orgUnits.new') }}</h3>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('orgUnitForm.name') }}</span>
          <input v-model="draft.name" class="bg-input" :placeholder="t('orgUnitForm.namePlaceholder')" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('orgUnitForm.parent') }}</span>
          <select v-model="draft.parentId" class="bg-input">
            <option :value="null">{{ t('orgUnitForm.noParent') }}</option>
            <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('orgUnitForm.head') }}</span>
          <select v-model="draft.headUserId" class="bg-input">
            <option value="">{{ t('orgUnitForm.noHead') }}</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }} ({{ u.email }})</option>
          </select>
        </label>
      </div>
      <div class="mt-4 flex gap-2">
        <button class="btn-primary" @click="save"><Save class="h-4 w-4" /> {{ t('orgUnits.create') }}</button>
        <button class="btn-ghost" @click="cancel"><X class="h-4 w-4" /> {{ t('common.cancel') }}</button>
      </div>
    </div>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 3" :key="n" class="card h-16 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else class="mt-6">
      <ListControls
        v-model:query="search"
        :count="filteredUnits.length"
        :total="units.length"
      />
      <div class="flex flex-col gap-3">
      <div v-for="u in filteredUnits" :key="u.id" class="card overflow-hidden">
        <div
          class="flex cursor-pointer items-center gap-3 px-5 py-4 transition hover:bg-pastel-sky/20"
          :style="{ paddingLeft: `${1.25 + depthOf(u) * 1.25}rem` }"
          @click="expandedId === u.id ? cancel() : startEdit(u)"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-sans text-sm font-semibold text-ink">{{ u.name }}</span>
              <span v-if="isRoot(u)" class="pill bg-accent-light/60 text-accent">{{ t('orgUnits.rootBadge') }}</span>
            </div>
            <div class="truncate font-mono text-xs text-ink-light">
              {{ t('orgUnits.headLabel', { head: u.headUserId ? headName(u.headUserId) : t('orgUnits.noHead') }) }}
            </div>
          </div>
          <span class="pill min-w-[6rem] bg-pastel-mint/50 text-emerald-700">
            {{ t('orgUnits.memberCount', { count: memberCount(u.id) }, memberCount(u.id)) }}
          </span>
          <ChevronDown class="h-4 w-4 text-ink-light transition" :class="expandedId === u.id ? 'rotate-180' : ''" />
        </div>

        <Transition name="list">
          <div v-if="expandedId === u.id && draft" class="border-t border-line bg-pastel-sky/10 p-5">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label class="flex flex-col gap-1">
                <span class="form-label">{{ t('orgUnitForm.name') }}</span>
                <input v-model="draft.name" class="bg-input" :disabled="isRoot(u)" />
                <span v-if="isRoot(u)" class="font-mono text-[11px] text-ink-light">{{ t('orgUnitForm.rootNameHint') }}</span>
              </label>
              <label v-if="!isRoot(u)" class="flex flex-col gap-1">
                <span class="form-label">{{ t('orgUnitForm.parent') }}</span>
                <select v-model="draft.parentId" class="bg-input">
                  <option :value="null">{{ t('orgUnitForm.noParent') }}</option>
                  <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="form-label">{{ t('orgUnitForm.head') }}</span>
                <select v-model="draft.headUserId" class="bg-input">
                  <option value="">{{ t('orgUnitForm.noHead') }}</option>
                  <option v-for="us in users" :key="us.id" :value="us.id">{{ us.name }} ({{ us.email }})</option>
                </select>
              </label>
            </div>

            <!-- Bulk add members -->
            <div class="mt-4 border-t border-line pt-4">
              <button class="btn-ghost !px-3 !py-1.5 !text-xs" @click="addMembersOpen = !addMembersOpen">
                <UserPlus class="h-3.5 w-3.5" /> {{ t('orgUnits.addMembers') }}
              </button>
              <div v-if="addMembersOpen" class="mt-3">
                <p class="mb-2 font-mono text-[11px] text-ink-light">{{ t('orgUnits.addMembersHint') }}</p>
                <input
                  v-model="memberQuery"
                  class="bg-input mb-2 w-full"
                  :placeholder="t('orgUnits.memberSearch')"
                />
                <div class="max-h-64 overflow-y-auto rounded-md border border-line bg-white">
                  <label
                    v-for="us in memberCandidates"
                    :key="us.id"
                    class="flex cursor-pointer items-center gap-2 border-b border-line/60 px-3 py-2 text-sm transition last:border-0 hover:bg-pastel-sky/20"
                  >
                    <input
                      type="checkbox"
                      class="accent-accent"
                      :checked="selectedMemberIds.includes(us.id)"
                      @change="toggleMember(us.id)"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="font-medium text-ink">{{ us.name }}</span>
                      <span class="font-mono text-[11px] text-ink-light"> · {{ us.email }}</span>
                    </span>
                    <span class="shrink-0 font-mono text-[10px] text-ink-light">
                      {{ t('orgUnits.currentlyIn', { unit: unitName(us.orgUnitId ?? null) }) }}
                    </span>
                  </label>
                  <p v-if="memberCandidates.length === 0" class="px-3 py-4 text-center font-mono text-xs text-ink-light">
                    {{ t('orgUnits.noCandidates') }}
                  </p>
                </div>
                <div class="mt-2">
                  <button
                    class="btn-primary !px-3 !py-1.5 !text-xs"
                    :disabled="selectedMemberIds.length === 0"
                    @click="addMembers"
                  >
                    <UserPlus class="h-3.5 w-3.5" />
                    {{ t('orgUnits.addSelected', { count: selectedMemberIds.length }, selectedMemberIds.length) }}
                  </button>
                </div>
              </div>
            </div>

            <div class="mt-4 flex items-center gap-2">
              <button class="btn-primary" @click="save"><Save class="h-4 w-4" /> {{ t('orgUnits.save') }}</button>
              <button class="btn-ghost" @click="cancel"><X class="h-4 w-4" /> {{ t('common.cancel') }}</button>
              <div class="flex-1" />
              <template v-if="!isRoot(u)">
                <template v-if="confirmDeleteId === u.id">
                  <span class="font-mono text-xs text-rose-600">{{ t('orgUnits.deleteConfirm') }}</span>
                  <button class="btn-danger !px-3 !py-1.5" @click="remove(u.id)">{{ t('orgUnits.deleteYes') }}</button>
                  <button class="btn-ghost !px-3 !py-1.5" @click="confirmDeleteId = null">{{ t('orgUnits.deleteNo') }}</button>
                </template>
                <button v-else class="btn-danger !px-3 !py-1.5" @click="confirmDeleteId = u.id">
                  <Trash2 class="h-4 w-4" /> {{ t('common.delete') }}
                </button>
              </template>
            </div>
          </div>
        </Transition>
      </div>
      <p v-if="units.length === 0" class="font-mono text-sm text-ink-light">{{ t('orgUnits.empty') }}</p>
      <p v-else-if="filteredUnits.length === 0" class="font-mono text-sm text-ink-light">{{ t('common.noMatches') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-label {
  @apply font-sans text-xs font-semibold text-ink-muted;
}
</style>
