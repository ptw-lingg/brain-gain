<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, Plus, Save, Trash2, X } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { JobRole, Training } from '@/types';
import RoleForm from '@/components/RoleForm.vue';
import ListControls from '@/components/ListControls.vue';
import { matchesQuery } from '@/utils/listFilter';

const toast = useToastStore();
const { t } = useI18n();

const roles = ref<JobRole[]>([]);
const trainings = ref<Training[]>([]);
const loading = ref(true);
const expandedId = ref<string | null>(null);
const draft = ref<JobRole | null>(null);
const confirmDeleteId = ref<string | null>(null);
const search = ref('');

const filteredRoles = computed(() =>
  roles.value.filter((r) =>
    matchesQuery(search.value, r.name, r.description, ...r.trainingIds.map(trainingName)),
  ),
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [r, t] = await Promise.all([
      client.get<JobRole[]>('/roles'),
      client.get<Training[]>('/trainings'),
    ]);
    roles.value = r.data;
    trainings.value = t.data;
  } finally {
    loading.value = false;
  }
}

function trainingName(id: string): string {
  return trainings.value.find((tr) => tr.id === id)?.name ?? t('common.none');
}

function startCreate(): void {
  draft.value = { id: '', name: '', description: '', trainingIds: [] };
  expandedId.value = '__new__';
}
function startEdit(r: JobRole): void {
  draft.value = JSON.parse(JSON.stringify(r));
  expandedId.value = r.id;
}
function cancel(): void {
  draft.value = null;
  expandedId.value = null;
}
function toggleTraining(id: string): void {
  if (!draft.value) return;
  const i = draft.value.trainingIds.indexOf(id);
  if (i === -1) draft.value.trainingIds.push(id);
  else draft.value.trainingIds.splice(i, 1);
}

async function save(): Promise<void> {
  if (!draft.value) return;
  if (!draft.value.name.trim()) {
    toast.error(t('roles.toasts.nameRequired'));
    return;
  }
  try {
    if (draft.value.id) {
      await client.put(`/roles/${draft.value.id}`, draft.value);
      toast.success(t('roles.toasts.updated'));
    } else {
      await client.post('/roles', draft.value);
      toast.success(t('roles.toasts.created'));
    }
    cancel();
    await load();
  } catch {
    toast.error(t('roles.toasts.saveError'));
  }
}

async function remove(id: string): Promise<void> {
  try {
    await client.delete(`/roles/${id}`);
    toast.success(t('roles.toasts.deleted'));
    confirmDeleteId.value = null;
    if (expandedId.value === id) cancel();
    await load();
  } catch {
    toast.error(t('roles.toasts.deleteError'));
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="flex items-center justify-between">
      <div>
        <h1 class="page-title">{{ t('roles.title') }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">{{ t('roles.subtitle', { count: roles.length }) }}</p>
      </div>
      <button class="btn-primary" @click="startCreate"><Plus class="h-4 w-4" /> {{ t('roles.add') }}</button>
    </header>

    <!-- New -->
    <div v-if="expandedId === '__new__' && draft" class="mt-6 card border-accent/40 p-5">
      <h3 class="mb-3 font-sans text-sm font-bold text-accent">{{ t('roles.new') }}</h3>
      <RoleForm :draft="draft" :trainings="trainings" @toggle="toggleTraining" />
      <div class="mt-4 flex gap-2">
        <button class="btn-primary" @click="save"><Save class="h-4 w-4" /> {{ t('roles.create') }}</button>
        <button class="btn-ghost" @click="cancel"><X class="h-4 w-4" /> {{ t('common.cancel') }}</button>
      </div>
    </div>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 3" :key="n" class="card h-16 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else class="mt-6">
      <ListControls
        v-model:query="search"
        :count="filteredRoles.length"
        :total="roles.length"
      />
      <div class="flex flex-col gap-3">
      <div v-for="r in filteredRoles" :key="r.id" class="card overflow-hidden">
        <div
          class="flex cursor-pointer items-center gap-3 px-5 py-4 transition hover:bg-pastel-sky/20"
          @click="expandedId === r.id ? cancel() : startEdit(r)"
        >
          <div class="min-w-0 flex-1">
            <div class="font-sans text-sm font-semibold text-ink">{{ r.name }}</div>
            <div class="truncate font-mono text-xs text-ink-light" :title="r.description">{{ r.description }}</div>
          </div>
          <span class="pill min-w-[7rem] bg-pastel-mint/50 text-emerald-700">
            {{ t('roles.trainingsCount', { count: r.trainingIds.length }, r.trainingIds.length) }}
          </span>
          <ChevronDown
            class="h-4 w-4 text-ink-light transition"
            :class="expandedId === r.id ? 'rotate-180' : ''"
          />
        </div>

        <Transition name="list">
          <div v-if="expandedId === r.id && draft" class="border-t border-line bg-pastel-sky/10 p-5">
            <RoleForm :draft="draft" :trainings="trainings" @toggle="toggleTraining" />
            <div class="mt-4 flex items-center gap-2">
              <button class="btn-primary" @click="save"><Save class="h-4 w-4" /> {{ t('roles.save') }}</button>
              <button class="btn-ghost" @click="cancel"><X class="h-4 w-4" /> {{ t('common.cancel') }}</button>
              <div class="flex-1" />
              <template v-if="confirmDeleteId === r.id">
                <span class="font-mono text-xs text-rose-600">{{ t('roles.deleteConfirm') }}</span>
                <button class="btn-danger !px-3 !py-1.5" @click="remove(r.id)">{{ t('roles.deleteYes') }}</button>
                <button class="btn-ghost !px-3 !py-1.5" @click="confirmDeleteId = null">{{ t('roles.deleteNo') }}</button>
              </template>
              <button v-else class="btn-danger !px-3 !py-1.5" @click="confirmDeleteId = r.id">
                <Trash2 class="h-4 w-4" /> {{ t('common.delete') }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
      <p v-if="roles.length === 0" class="font-mono text-sm text-ink-light">{{ t('roles.empty') }}</p>
      <p v-else-if="filteredRoles.length === 0" class="font-mono text-sm text-ink-light">{{ t('common.noMatches') }}</p>
      </div>
    </div>
  </div>
</template>
