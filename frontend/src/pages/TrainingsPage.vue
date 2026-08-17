<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle, CheckCircle2, ChevronRight, Download, FileText, GripVertical, History, Plus, Save, Trash2, X } from 'lucide-vue-next';
import type { TCreatedPdf } from 'pdfmake/interfaces';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import type { JobRole, LocalizedText, MyTeam, Question, SafeUser, Settings, Training, TrainingDraft } from '@/types';
import TrainingForm from '@/components/TrainingForm.vue';
import PublishUpdateDialog from '@/components/PublishUpdateDialog.vue';
import ListControls from '@/components/ListControls.vue';
import { matchesQuery } from '@/utils/listFilter';
import { cycleLabel, formatDuration, trainingReadiness } from '@/utils/display';
import { resolveLocalized } from '@/utils/locales';

const auth = useAuthStore();
const toast = useToastStore();
const { t, locale } = useI18n();

// Localized master data resolved to the UI language (English fallback) for rows and dialog titles;
// the search box instead matches EVERY language of a field, whatever is currently displayed.
const resolved = (lt: LocalizedText): string => resolveLocalized(lt, locale.value).value;
const allTexts = (lt: LocalizedText): string[] => Object.values(lt ?? {});

const trainings = ref<Training[]>([]);
const owners = ref<SafeUser[]>([]);
const loading = ref(true);
// The editor is a modal dialog: `draft` non-null means it's open (a blank training = create, an
// existing id = edit/details). Replaces the former inline expand-in-place editor.
const draft = ref<Training | null>(null);
const confirmDeleteId = ref<string | null>(null);
const search = ref('');

const isAdmin = computed(() => auth.user?.isAdmin ?? false);
// The training plan covers the members the user is responsible for, so it is offered to admins (whole
// org) and unit heads (their subtree).
const canPlan = computed(() => (auth.user?.isAdmin ?? false) || (auth.user?.isHead ?? false));

const filteredTrainings = computed(() =>
  trainings.value.filter((tr) =>
    matchesQuery(
      search.value,
      ...allTexts(tr.name),
      ...allTexts(tr.description),
      ...allTexts(tr.category),
      ownerName(tr.ownerId),
      cycleLabel(t, tr.cycleYears),
    ),
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

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (publishTarget.value) publishTarget.value = null;
  else if (planOpen.value) closeTrainingPlan();
  else if (draft.value) cancel();
}

function blankTraining(): Training {
  return {
    id: '',
    name: {},
    description: {},
    durationMinutes: 60,
    category: { en: 'General' },
    ownerId: auth.user?.id ?? '',
    cycleYears: 1,
    windowBeforeMonths: 3,
    windowAfterMonths: 3,
    order: 0,
    materials: [],
    questions: [],
    version: 0,
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
}

// Open the dialog on a training to view its details / edit it (works on a deep clone so edits only
// take effect on save). The clone's content is the WORK-IN-PROGRESS: the server draft when one
// exists, else the published content — and the server's `draft` field itself is dropped so the
// local editing copy (also named `draft`) never carries the staging field along.
function openTraining(t: Training): void {
  const clone: Training = JSON.parse(JSON.stringify(t));
  clone.materials = JSON.parse(JSON.stringify(t.draft?.materials ?? t.materials));
  clone.questions = JSON.parse(JSON.stringify(t.draft?.questions ?? t.questions));
  delete clone.draft;
  draft.value = clone;
}

function cancel(): void {
  draft.value = null;
  confirmDeleteId.value = null;
}

function addQuestion(): void {
  // New questions start as single choice — the common case; the editor offers the switch to multiple.
  // Text and options are localized maps; the form seeds the configured languages for editing.
  draft.value?.questions.push({
    id: '',
    text: {},
    options: [{}, {}],
    correctIndices: [0],
    type: 'single',
  } as Question);
}
function removeQuestion(i: number): void {
  draft.value?.questions.splice(i, 1);
}
function addOption(q: Question): void {
  q.options.push({}); // the form seeds the configured languages for editing
}
function removeOption(q: Question, oi: number): void {
  q.options.splice(oi, 1);
  // Drop the removed option from the answer key and shift the indices above it down, so the key still
  // points at the same answers. Never leave it empty.
  const key = (q.correctIndices ?? [0])
    .filter((i) => i !== oi)
    .map((i) => (i > oi ? i - 1 : i));
  q.correctIndices = key.length ? key : [0];
}

// The publish-update dialog's target (non-null = open): offered after a save that changed the
// training's CONTENT (materials/questions), and openable from the editor to manage pending updates.
const publishTarget = ref<Training | null>(null);

async function save(): Promise<void> {
  if (!draft.value) return;
  const body = draft.value;
  // The server's rule: a training must be nameable in at least one language.
  if (!Object.values(body.name).some((v) => v.trim())) {
    toast.error(t('trainings.toasts.nameRequired'));
    return;
  }
  // The publish dialog is offered when a save STAGED new content: the server response carries a
  // draft whose content differs from the record's previous draft. Saving never publishes anything
  // by itself — trainees keep seeing the last published version until the editor publishes.
  const contentOf = (d?: TrainingDraft | null): string | null =>
    d ? JSON.stringify([d.materials, d.questions]) : null;
  try {
    if (body.id) {
      const before = trainings.value.find((x) => x.id === body.id);
      const { data: after } = await client.put<Training>(`/trainings/${body.id}`, body);
      toast.success(t('trainings.toasts.updated'));
      cancel();
      await load();
      const draftChanged =
        after.draft != null && contentOf(after.draft) !== contentOf(before?.draft ?? null);
      if (draftChanged) {
        publishTarget.value = trainings.value.find((x) => x.id === body.id) ?? after;
      }
    } else {
      const { data: created } = await client.post<Training>('/trainings', body);
      toast.success(t('trainings.toasts.created'));
      cancel();
      await load();
      // A new training starts unpublished; content it already carries can be published right away.
      if (created.draft != null) {
        publishTarget.value = trainings.value.find((x) => x.id === created.id) ?? created;
      }
    }
  } catch {
    toast.error(t('trainings.toasts.saveError'));
  }
}

// Open the publish dialog on the saved (server-shaped) training to review/cancel pending updates.
function openUpdates(): void {
  if (!draft.value?.id) return;
  publishTarget.value = trainings.value.find((x) => x.id === draft.value!.id) ?? null;
}

// After a publish or cancel inside the dialog: refresh the list and re-point the dialog at the
// reloaded record so its version/pending list is current.
async function onPublishChanged(): Promise<void> {
  await load();
  if (publishTarget.value) {
    publishTarget.value = trainings.value.find((x) => x.id === publishTarget.value!.id) ?? null;
  }
}

async function remove(id: string): Promise<void> {
  try {
    await client.delete(`/trainings/${id}`);
    toast.success(t('trainings.toasts.deleted'));
    cancel(); // close the dialog showing the now-deleted training
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

onMounted(() => {
  void load();
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
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
        <!-- Row — opens the detail/edit dialog -->
        <div
          class="flex cursor-pointer items-center gap-3 px-5 py-4 transition hover:bg-pastel-sky/20"
          role="button"
          tabindex="0"
          @click="openTraining(tr)"
          @keydown.enter="openTraining(tr)"
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
            <div class="font-sans text-sm font-semibold text-ink">{{ resolved(tr.name) }}</div>
            <div class="truncate font-mono text-xs text-ink-light" :title="resolved(tr.description)">{{ resolved(tr.description) }}</div>
          </div>
          <!-- Status column: trainees need material to study and questions to be tested. Missing either
               is flagged so trainers see what to finish; a complete training shows a green "Ready". The
               readiness is judged on the WORK-IN-PROGRESS content (the draft when one exists) — that is
               what the editor is preparing to publish. Publication state gets its own pills: amber
               "Not published yet" (version 0) and blue "Draft" (unpublished changes). The flags stack
               within a fixed-width cell so the row reads like a table. -->
          <div class="flex w-[8.5rem] shrink-0 flex-col justify-center gap-1">
            <span
              v-if="(tr.version ?? 1) === 0"
              class="pill w-full bg-amber-100 text-amber-700"
              :title="t('trainings.notPublishedTitle')"
            >
              <AlertTriangle class="h-3 w-3" /> {{ t('trainings.notPublished') }}
            </span>
            <span
              v-else-if="tr.draft"
              class="pill w-full bg-pastel-blue/60 text-blue-700"
              :title="t('trainings.draftPillTitle')"
            >
              {{ t('trainings.draftPill') }}
            </span>
            <span
              v-if="!trainingReadiness(tr.draft ?? tr).hasMaterial"
              class="pill w-full bg-amber-100 text-amber-700"
              :title="t('trainings.noMaterialTitle')"
            >
              <AlertTriangle class="h-3 w-3" /> {{ t('trainings.noMaterial') }}
            </span>
            <span
              v-if="!trainingReadiness(tr.draft ?? tr).hasQuestions"
              class="pill w-full bg-amber-100 text-amber-700"
              :title="t('trainings.noQuestionsTitle')"
            >
              <AlertTriangle class="h-3 w-3" /> {{ t('trainings.noQuestions') }}
            </span>
            <span
              v-if="trainingReadiness(tr.draft ?? tr).ready"
              class="pill w-full bg-pastel-mint/50 text-emerald-700"
              :title="t('trainings.readyTitle')"
            >
              <CheckCircle2 class="h-3 w-3" /> {{ t('trainings.ready') }}
            </span>
          </div>
          <span class="pill w-28 shrink-0 truncate bg-pastel-sky/60 text-ink-muted">{{ resolved(tr.category) }}</span>
          <span class="pill w-16 shrink-0 bg-pastel-slate/60 text-ink-muted">{{ formatDuration(tr.durationMinutes) }}</span>
          <span class="pill w-28 shrink-0 bg-pastel-mint/50 text-emerald-700">{{ cycleLabel(t, tr.cycleYears) }}</span>
          <span v-if="isAdmin" class="pill w-32 shrink-0 truncate bg-white text-ink-light">{{ ownerName(tr.ownerId) }}</span>
          <ChevronRight class="h-4 w-4 shrink-0 text-ink-light" />
        </div>
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
        <div
          class="relative z-10 flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-lift"
          role="dialog"
          aria-modal="true"
          :aria-label="planTitle || t('trainingPlan.modalTitle')"
        >
          <div class="flex items-center justify-between border-b border-line px-5 py-3">
            <div>
              <h2 class="font-sans text-base font-bold text-ink">{{ planTitle || t('trainingPlan.modalTitle') }}</h2>
              <p class="font-mono text-[11px] text-ink-light">
                <span v-if="!planBuilding">{{ planDocId }} · {{ t('trainingPlan.pages', { pages: planPages.length }) }}</span>
                <span v-else>{{ t('trainingPlan.rendering') }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn-primary btn-sm" :disabled="planBuilding || planPages.length === 0" @click="downloadTrainingPlan">
                <Download class="h-4 w-4" /> {{ t('trainingPlan.download') }}
              </button>
              <button class="text-ink-light hover:text-ink" :title="t('common.close')" :aria-label="t('common.close')" @click="closeTrainingPlan"><X class="h-5 w-5" /></button>
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

    <!-- Training detail / editor dialog (create when draft has no id, edit otherwise) -->
    <Transition name="fade-slide">
      <div v-if="draft" class="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-ink/40" @click="cancel" />
        <div
          class="relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-lift"
          role="dialog"
          aria-modal="true"
          :aria-label="draft.id ? resolved(draft.name) || t('trainings.edit') : t('trainings.new')"
        >
          <div class="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 class="min-w-0 truncate font-sans text-base font-bold text-ink">
              {{ draft.id ? resolved(draft.name) || t('trainings.edit') : t('trainings.new') }}
            </h2>
            <button class="ml-3 shrink-0 text-ink-light hover:text-ink" :title="t('common.close')" :aria-label="t('common.close')" @click="cancel">
              <X class="h-5 w-5" />
            </button>
          </div>

          <!-- Tinted like the preview modals, so the collapsible sections read as separate surfaces. -->
          <div class="flex-1 overflow-y-auto bg-pastel-slate/20 p-4">
            <TrainingForm
              :draft="draft"
              :is-admin="isAdmin"
              :owners="owners"
              @add-question="addQuestion"
              @remove-question="removeQuestion"
              @add-option="addOption"
              @remove-option="removeOption"
            />
          </div>

          <div class="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
            <button class="btn-primary" @click="save">
              <Save class="h-4 w-4" /> {{ draft.id ? t('trainings.save') : t('trainings.create') }}
            </button>
            <button class="btn-ghost" @click="cancel"><X class="h-4 w-4" /> {{ t('common.cancel') }}</button>
            <!-- Version management: review/withdraw published versions and publish manually.
                 Editor-side language is "versions" (the learner receives them as "updates"). -->
            <button v-if="draft.id" class="btn-ghost" data-testid="manage-updates" @click="openUpdates">
              <History class="h-4 w-4" />
              {{ t('trainings.publish.manage', { version: draft.version ?? 1 }) }}
            </button>
            <div class="flex-1" />
            <template v-if="draft.id">
              <template v-if="confirmDeleteId === draft.id">
                <span class="font-mono text-xs text-rose-600">{{ t('trainings.deleteConfirm') }}</span>
                <button class="btn-danger btn-sm" @click="remove(draft.id)">{{ t('trainings.deleteYes') }}</button>
                <button class="btn-ghost btn-sm" @click="confirmDeleteId = null">{{ t('trainings.deleteNo') }}</button>
              </template>
              <button v-else class="btn-danger btn-sm" @click="confirmDeleteId = draft.id">
                <Trash2 class="h-4 w-4" /> {{ t('common.delete') }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Publish/versions step: offered after a content-staging save; also opened via "Versions".
         Deliberately NOT animated: it often opens the instant the editor dialog closes, and a
         moving mount makes clicks racy (buttons shift under the pointer during the transition). -->
    <PublishUpdateDialog
      v-if="publishTarget"
      :training="publishTarget"
      @close="publishTarget = null"
      @changed="onPublishChanged"
    />
  </div>
</template>
