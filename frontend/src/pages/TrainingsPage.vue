<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, Download, FileText, GripVertical, Plus, Save, Trash2, X } from 'lucide-vue-next';
import type { TCreatedPdf } from 'pdfmake/interfaces';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import type { JobRole, MaterialLink, MyTeam, Question, SafeUser, Settings, Training } from '@/types';
import TrainingForm from '@/components/TrainingForm.vue';
import ListControls from '@/components/ListControls.vue';
import { matchesQuery } from '@/utils/listFilter';
import { cycleLabel } from '@/utils/display';

const auth = useAuthStore();
const toast = useToastStore();
const { t } = useI18n();

const trainings = ref<Training[]>([]);
const owners = ref<SafeUser[]>([]);
const loading = ref(true);
const expandedId = ref<string | null>(null);
const draft = ref<Training | null>(null); // editing buffer (also used for new)
const confirmDeleteId = ref<string | null>(null);
const search = ref('');

const isAdmin = computed(() => auth.user?.isAdmin ?? false);
// The training plan covers the members the user is responsible for, so it is offered to admins (whole
// org) and unit heads (their subtree).
const canPlan = computed(() => (auth.user?.isAdmin ?? false) || (auth.user?.isHead ?? false));

const filteredTrainings = computed(() =>
  trainings.value.filter((tr) =>
    matchesQuery(search.value, tr.name, tr.description, tr.category, ownerName(tr.ownerId), cycleLabel(t, tr.cycleYears)),
  ),
);

// Training Plan controlled document (admin): the trainings, roles→trainings and members→roles, built
// → previewed inline → downloaded for transfer to the DMS (view-before-download, like the team report).
const planBuilding = ref(false);
const planOpen = ref(false);
const planPages = ref<string[]>([]);
const planTitle = ref('');
const planDocId = ref('');
let currentPlanPdf: TCreatedPdf | null = null;
let planFileName = '';

async function openTrainingPlan(): Promise<void> {
  planBuilding.value = true;
  planOpen.value = true;
  planPages.value = [];
  try {
    // The full training catalog + all roles, plus the members the user is responsible for: an admin
    // oversees the whole organization; a head oversees the members in the units they head (subtree).
    const [allTrainingsRes, rolesRes, settingsRes] = await Promise.all([
      client.get<Training[]>('/trainings'),
      client.get<JobRole[]>('/roles'),
      client.get<Settings>('/settings'),
    ]);
    let members: SafeUser[];
    let responsibleFor: string;
    if (auth.user?.isAdmin) {
      members = (await client.get<SafeUser[]>('/users')).data;
      responsibleFor = t('trainingPlan.scopeAll');
    } else {
      const { data } = await client.get<MyTeam>('/org-units/my-team');
      members = data.members.map((m) => m.user);
      responsibleFor = data.units.map((u) => u.name).join(', ');
    }
    const { buildTrainingPlan } = await import('@/utils/trainingPlan');
    const { createPdf } = await import('@/utils/pdf');
    const { renderPdfToImages } = await import('@/utils/pdfPreview');
    const { def, fileName, docId, title } = buildTrainingPlan(
      { trainings: allTrainingsRes.data, roles: rolesRes.data, members },
      {
        company: settingsRes.data.companyName ?? '',
        preparedBy: auth.user?.name ?? '',
        generatedOn: new Date().toISOString().slice(0, 10),
        responsibleFor,
      },
      t,
    );
    planFileName = fileName;
    planTitle.value = title;
    planDocId.value = docId;
    currentPlanPdf = createPdf(def);
    const bytes = await (await currentPlanPdf.getBlob()).arrayBuffer();
    planPages.value = await renderPdfToImages(bytes);
  } catch {
    toast.error(t('trainingPlan.error'));
    closeTrainingPlan();
  } finally {
    planBuilding.value = false;
  }
}

// Download is reachable only from the open preview (view-before-download).
function downloadTrainingPlan(): void {
  if (currentPlanPdf) currentPlanPdf.download(planFileName);
}

function closeTrainingPlan(): void {
  planOpen.value = false;
  planBuilding.value = false;
  planPages.value = [];
  currentPlanPdf = null;
}

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
    order: 0,
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
    trainings.value = t.data; // kept in the deliberate display order (admin drag-to-reorder)
    owners.value = u.data
      .filter((x) => x.isTrainer || x.isAdmin)
      .sort((a, b) => a.name.localeCompare(b.name)); // alphabetical owner dropdown
  } finally {
    loading.value = false;
  }
}

function ownerName(id: string): string {
  return owners.value.find((o) => o.id === id)?.name ?? (id === auth.user?.id ? t('trainings.ownerYou') : t('common.none'));
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
    toast.error(t('trainings.toasts.nameRequired'));
    return;
  }
  try {
    if (body.id) {
      await client.put(`/trainings/${body.id}`, body);
      toast.success(t('trainings.toasts.updated'));
    } else {
      await client.post('/trainings', body);
      toast.success(t('trainings.toasts.created'));
    }
    cancel();
    await load();
  } catch {
    toast.error(t('trainings.toasts.saveError'));
  }
}

async function remove(id: string): Promise<void> {
  try {
    await client.delete(`/trainings/${id}`);
    toast.success(t('trainings.toasts.deleted'));
    confirmDeleteId.value = null;
    if (expandedId.value === id) cancel();
    await load();
  } catch {
    toast.error(t('trainings.toasts.deleteError'));
  }
}

// --- Drag-and-drop reordering (admin only) ---
// `dragEnabled` is flipped on by the grip handle's mousedown so the row only
// becomes draggable when grabbed by the handle (not when clicked to expand).
const dragEnabled = ref(false);
// Reorder is tracked by id (not list index) so it stays correct even though the rendered list is a
// filtered view; reordering is only offered when the search box is empty (see :draggable below).
const dragId = ref<string | null>(null);

function onDragStart(tr: Training): void {
  dragId.value = tr.id;
  cancel(); // collapse any open editor so the list stays stable while dragging
}

function onDragOver(tr: Training): void {
  if (dragId.value === null || dragId.value === tr.id) return;
  const list = trainings.value;
  const from = list.findIndex((x) => x.id === dragId.value);
  const to = list.findIndex((x) => x.id === tr.id);
  if (from === -1 || to === -1) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved); // follow the item to its new slot
}

function onDragEnd(): void {
  dragEnabled.value = false;
  dragId.value = null;
}

async function persistOrder(): Promise<void> {
  const moved = dragId.value !== null;
  onDragEnd();
  if (!moved) return;
  try {
    await client.put('/trainings/reorder', { ids: trainings.value.map((tr) => tr.id) });
    toast.success(t('trainings.toasts.orderSaved'));
  } catch {
    toast.error(t('trainings.toasts.orderError'));
    await load(); // restore the server's order on failure
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="flex items-center justify-between">
      <div>
        <h1 class="page-title">{{ t('trainings.title') }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">
          {{ isAdmin ? t('trainings.subtitleAll') : t('trainings.subtitleOwn') }} · {{ trainings.length }}<span v-if="isAdmin"> · {{ t('trainings.dragToReorder') }}</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button v-if="canPlan" class="btn-ghost" :disabled="planBuilding" @click="openTrainingPlan">
          <FileText class="h-4 w-4" /> {{ t('trainingPlan.generate') }}
        </button>
        <button class="btn-primary" @click="startCreate"><Plus class="h-4 w-4" /> {{ t('trainings.add') }}</button>
      </div>
    </header>

    <!-- New draft editor -->
    <div v-if="expandedId === '__new__' && draft" class="mt-6">
      <div class="card border-accent/40 p-5">
        <h3 class="mb-3 font-sans text-sm font-bold text-accent">{{ t('trainings.new') }}</h3>
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
          <button class="btn-primary" @click="save"><Save class="h-4 w-4" /> {{ t('trainings.create') }}</button>
          <button class="btn-ghost" @click="cancel"><X class="h-4 w-4" /> {{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 3" :key="n" class="card h-16 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else class="mt-6">
      <ListControls
        v-model:query="search"
        :count="filteredTrainings.length"
        :total="trainings.length"
      />
      <div class="flex flex-col gap-3">
      <div
        v-for="tr in filteredTrainings"
        :key="tr.id"
        class="card overflow-hidden transition"
        :class="dragId === tr.id ? 'opacity-50 ring-2 ring-accent/50' : ''"
        :draggable="isAdmin && dragEnabled && !search.trim()"
        @dragstart="onDragStart(tr)"
        @dragover.prevent="onDragOver(tr)"
        @drop="persistOrder"
        @dragend="onDragEnd"
      >
        <!-- Row -->
        <div
          class="flex cursor-pointer items-center gap-3 px-5 py-4 transition hover:bg-pastel-sky/20"
          @click="expandedId === tr.id ? cancel() : startEdit(tr)"
        >
          <button
            v-if="isAdmin"
            type="button"
            :title="t('trainings.dragHandleTitle')"
            class="-ml-1 shrink-0 cursor-grab touch-none text-ink-light transition hover:text-ink active:cursor-grabbing"
            @click.stop
            @mousedown="dragEnabled = true"
            @mouseup="dragEnabled = false"
          >
            <GripVertical class="h-4 w-4" />
          </button>
          <div class="min-w-0 flex-1">
            <div class="font-sans text-sm font-semibold text-ink">{{ tr.name }}</div>
            <div class="truncate font-mono text-xs text-ink-light" :title="tr.description">{{ tr.description }}</div>
          </div>
          <span class="pill pill-col bg-pastel-sky/60 text-ink-muted">{{ tr.category }}</span>
          <span class="pill min-w-[3.5rem] bg-pastel-slate/60 text-ink-muted">{{ t('trainingCard.hours', { hours: tr.durationHours }) }}</span>
          <span class="pill min-w-[5rem] bg-pastel-mint/50 text-emerald-700">{{ cycleLabel(t, tr.cycleYears) }}</span>
          <span v-if="isAdmin" class="pill pill-col bg-white text-ink-light">{{ ownerName(tr.ownerId) }}</span>
          <ChevronDown
            class="h-4 w-4 text-ink-light transition"
            :class="expandedId === tr.id ? 'rotate-180' : ''"
          />
        </div>

        <!-- Expanded editor -->
        <Transition name="list">
          <div v-if="expandedId === tr.id && draft" class="border-t border-line bg-pastel-sky/10 p-5">
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
              <button class="btn-primary" @click="save"><Save class="h-4 w-4" /> {{ t('trainings.save') }}</button>
              <button class="btn-ghost" @click="cancel"><X class="h-4 w-4" /> {{ t('common.cancel') }}</button>
              <div class="flex-1" />
              <template v-if="confirmDeleteId === tr.id">
                <span class="font-mono text-xs text-rose-600">{{ t('trainings.deleteConfirm') }}</span>
                <button class="btn-danger !px-3 !py-1.5" @click="remove(tr.id)">{{ t('trainings.deleteYes') }}</button>
                <button class="btn-ghost !px-3 !py-1.5" @click="confirmDeleteId = null">{{ t('trainings.deleteNo') }}</button>
              </template>
              <button
                v-else
                class="btn-danger !px-3 !py-1.5"
                @click="confirmDeleteId = tr.id"
              >
                <Trash2 class="h-4 w-4" /> {{ t('common.delete') }}
              </button>
            </div>
          </div>
        </Transition>
      </div>

      <p v-if="trainings.length === 0" class="font-mono text-sm text-ink-light">
        {{ t('trainings.empty') }}
      </p>
      <p v-else-if="filteredTrainings.length === 0" class="font-mono text-sm text-ink-light">
        {{ t('common.noMatches') }}
      </p>
      </div>
    </div>

    <!-- Training Plan preview → gated download (transfer to DMS) -->
    <Transition name="fade-slide">
      <div v-if="planOpen" class="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-ink/40" @click="closeTrainingPlan" />
        <div class="relative z-10 flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-lift">
          <div class="flex items-center justify-between border-b border-line px-5 py-3">
            <div>
              <h2 class="font-sans text-base font-bold text-ink">{{ planTitle || t('trainingPlan.modalTitle') }}</h2>
              <p class="font-mono text-[11px] text-ink-light">
                <span v-if="!planBuilding">{{ planDocId }} · {{ t('trainingPlan.pages', { pages: planPages.length }) }}</span>
                <span v-else>{{ t('trainingPlan.rendering') }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn-primary !px-3 !py-1.5 !text-xs" :disabled="planBuilding || planPages.length === 0" @click="downloadTrainingPlan">
                <Download class="h-4 w-4" /> {{ t('trainingPlan.download') }}
              </button>
              <button class="text-ink-light hover:text-ink" :title="t('common.close')" @click="closeTrainingPlan"><X class="h-5 w-5" /></button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto bg-pastel-slate/20 p-4">
            <div v-if="planPages.length" class="mx-auto flex max-w-3xl flex-col items-center gap-3">
              <img v-for="(p, i) in planPages" :key="i" :src="p" data-pdf-page class="w-full rounded shadow-soft" :alt="t('trainingPlan.pageAlt', { n: i + 1 })" />
            </div>
            <div v-else class="flex h-full items-center justify-center font-mono text-sm text-ink-light">{{ t('trainingPlan.rendering') }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
