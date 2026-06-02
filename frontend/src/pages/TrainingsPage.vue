<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronDown, Plus, Save, Trash2, X } from 'lucide-vue-next';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import type { MaterialLink, Question, SafeUser, Training } from '@/types';
import TrainingForm from '@/components/TrainingForm.vue';

const auth = useAuthStore();
const toast = useToastStore();

const trainings = ref<Training[]>([]);
const owners = ref<SafeUser[]>([]);
const loading = ref(true);
const expandedId = ref<string | null>(null);
const draft = ref<Training | null>(null); // editing buffer (also used for new)
const confirmDeleteId = ref<string | null>(null);

const isAdmin = computed(() => auth.user?.isAdmin ?? false);

function blankTraining(): Training {
  return {
    id: '',
    name: '',
    description: '',
    durationHours: 1,
    category: 'General',
    ownerId: auth.user?.id ?? '',
    cycleYears: 1,
    windowBeforeMonths: 3,
    windowAfterMonths: 3,
    materialLinks: [],
    questions: [],
    createdAt: '',
  };
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const params = isAdmin.value ? {} : { mine: '1' };
    const [t, u] = await Promise.all([
      client.get<Training[]>('/trainings', { params }),
      isAdmin.value
        ? client.get<SafeUser[]>('/users')
        : Promise.resolve({ data: [] as SafeUser[] }),
    ]);
    trainings.value = t.data;
    owners.value = u.data.filter((x) => x.isTrainer || x.isAdmin);
  } finally {
    loading.value = false;
  }
}

function ownerName(id: string): string {
  return owners.value.find((o) => o.id === id)?.name ?? (id === auth.user?.id ? 'You' : '—');
}

function startCreate(): void {
  draft.value = blankTraining();
  expandedId.value = '__new__';
}

function startEdit(t: Training): void {
  draft.value = JSON.parse(JSON.stringify(t));
  expandedId.value = t.id;
}

function cancel(): void {
  draft.value = null;
  expandedId.value = null;
}

function addLink(): void {
  draft.value?.materialLinks.push({ label: '', url: '' } as MaterialLink);
}
function removeLink(i: number): void {
  draft.value?.materialLinks.splice(i, 1);
}

function addQuestion(): void {
  draft.value?.questions.push({
    id: '',
    text: '',
    options: ['', ''],
    correctIndex: 0,
  } as Question);
}
function removeQuestion(i: number): void {
  draft.value?.questions.splice(i, 1);
}
function addOption(q: Question): void {
  q.options.push('');
}
function removeOption(q: Question, oi: number): void {
  q.options.splice(oi, 1);
  if (q.correctIndex && q.correctIndex >= q.options.length) q.correctIndex = 0;
}

async function save(): Promise<void> {
  if (!draft.value) return;
  const body = draft.value;
  if (!body.name.trim()) {
    toast.error('Name is required');
    return;
  }
  try {
    if (body.id) {
      await client.put(`/trainings/${body.id}`, body);
      toast.success('Training updated');
    } else {
      await client.post('/trainings', body);
      toast.success('Training created');
    }
    cancel();
    await load();
  } catch {
    toast.error('Could not save training');
  }
}

async function remove(id: string): Promise<void> {
  try {
    await client.delete(`/trainings/${id}`);
    toast.success('Training deleted');
    confirmDeleteId.value = null;
    if (expandedId.value === id) cancel();
    await load();
  } catch {
    toast.error('Could not delete training');
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="flex items-center justify-between">
      <div>
        <h1 class="page-title">Trainings</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">
          // {{ isAdmin ? 'all trainings' : 'trainings you own' }} · {{ trainings.length }}
        </p>
      </div>
      <button class="btn-primary" @click="startCreate"><Plus class="h-4 w-4" /> Add Training</button>
    </header>

    <!-- New draft editor -->
    <div v-if="expandedId === '__new__' && draft" class="mt-6">
      <div class="card border-accent/40 p-5">
        <h3 class="mb-3 font-sans text-sm font-bold text-accent">New training</h3>
        <TrainingForm
          :draft="draft"
          :is-admin="isAdmin"
          :owners="owners"
          @add-link="addLink"
          @remove-link="removeLink"
          @add-question="addQuestion"
          @remove-question="removeQuestion"
          @add-option="addOption"
          @remove-option="removeOption"
        />
        <div class="mt-4 flex gap-2">
          <button class="btn-primary" @click="save"><Save class="h-4 w-4" /> Create</button>
          <button class="btn-ghost" @click="cancel"><X class="h-4 w-4" /> Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 3" :key="n" class="card h-16 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else class="mt-6 flex flex-col gap-3">
      <div v-for="t in trainings" :key="t.id" class="card overflow-hidden">
        <!-- Row -->
        <div
          class="flex cursor-pointer items-center gap-3 px-5 py-4 transition hover:bg-pastel-sky/20"
          @click="expandedId === t.id ? cancel() : startEdit(t)"
        >
          <div class="min-w-0 flex-1">
            <div class="font-sans text-sm font-semibold text-ink">{{ t.name }}</div>
            <div class="truncate font-mono text-xs text-ink-light">{{ t.description }}</div>
          </div>
          <span class="pill bg-pastel-sky/60 text-ink-muted">{{ t.category }}</span>
          <span class="pill bg-pastel-slate/60 text-ink-muted">{{ t.durationHours }}h</span>
          <span class="pill bg-pastel-mint/50 text-emerald-700">every {{ t.cycleYears }}y</span>
          <span v-if="isAdmin" class="pill bg-white text-ink-light">{{ ownerName(t.ownerId) }}</span>
          <ChevronDown
            class="h-4 w-4 text-ink-light transition"
            :class="expandedId === t.id ? 'rotate-180' : ''"
          />
        </div>

        <!-- Expanded editor -->
        <Transition name="list">
          <div v-if="expandedId === t.id && draft" class="border-t border-line bg-pastel-sky/10 p-5">
            <TrainingForm
              :draft="draft"
              :is-admin="isAdmin"
              :owners="owners"
              @add-link="addLink"
              @remove-link="removeLink"
              @add-question="addQuestion"
              @remove-question="removeQuestion"
              @add-option="addOption"
              @remove-option="removeOption"
            />
            <div class="mt-4 flex items-center gap-2">
              <button class="btn-primary" @click="save"><Save class="h-4 w-4" /> Save</button>
              <button class="btn-ghost" @click="cancel"><X class="h-4 w-4" /> Cancel</button>
              <div class="flex-1" />
              <template v-if="confirmDeleteId === t.id">
                <span class="font-mono text-xs text-rose-600">Delete this training?</span>
                <button class="btn-danger !px-3 !py-1.5" @click="remove(t.id)">Yes, delete</button>
                <button class="btn-ghost !px-3 !py-1.5" @click="confirmDeleteId = null">No</button>
              </template>
              <button
                v-else
                class="btn-danger !px-3 !py-1.5"
                @click="confirmDeleteId = t.id"
              >
                <Trash2 class="h-4 w-4" /> Delete
              </button>
            </div>
          </div>
        </Transition>
      </div>

      <p v-if="trainings.length === 0" class="font-mono text-sm text-ink-light">
        No trainings yet. Click “Add Training” to create one.
      </p>
    </div>
  </div>
</template>
