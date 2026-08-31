<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, Trash2, Link as LinkIcon, HelpCircle, Paperclip, Upload, Loader2, FileText, Info, CalendarClock, X, ChevronUp, ChevronDown, Package, AlertTriangle } from 'lucide-vue-next';
import axios from 'axios';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import CollapsibleSection from '@/components/CollapsibleSection.vue';
import LocaleFlag from '@/components/LocaleFlag.vue';
import type { LocalizedText, Material, MaterialFile, MaterialVariant, Question, SafeUser, ScormAttemptSummary, ScormPackageRef, Training } from '@/types';
import { formatBytes, formatDuration } from '@/utils/display';
import { MATERIAL_LOCALES, resolveLocalized } from '@/utils/locales';

const { t, locale } = useI18n();
const toast = useToastStore();

const props = defineProps<{
  draft: Training;
  isAdmin: boolean;
  owners: SafeUser[];
}>();

// The fixed content languages — one editable row per language on materials, questions and answers,
// each prefixed by the language's flag alone (the flag carries the language name for a11y).
const materialLocales = MATERIAL_LOCALES;

defineEmits<{
  'add-question': [];
  'remove-question': [i: number];
  'add-option': [q: Question];
  'remove-option': [q: Question, oi: number];
}>();

const cycleOptions = [1, 2, 3, 4, 5];
const windowOptions = [0, 1, 2, 3];

// ── sections ──────────────────────────────────────────────────────────────────────────────────────
// The record grows without bound (each question with four options adds ~15 controls), so the editor is
// grouped into collapsible sections. Basics is open on arrival; the rest report what they hold in a
// summary badge so nothing is hidden without a trace, and anything the author adds opens itself.
const open = ref({ basics: true, schedule: false, material: false, scorm: false, questions: false });
const openQuestions = ref<Record<number, boolean>>({});
const toggle = (key: keyof typeof open.value): void => { open.value[key] = !open.value[key]; };
const toggleQuestion = (i: number): void => { openQuestions.value[i] = !openQuestions.value[i]; };

const materialCount = computed(() => props.draft.materials?.length ?? 0);
const questionCount = computed(() => props.draft.questions?.length ?? 0);

// Deliberately not the name — the dialog header already shows it, and repeating it here would put a
// second copy of the training name on the page.
const basicsSummary = computed(() =>
  [resolveLocalized(props.draft.category, locale.value).value, formatDuration(props.draft.durationMinutes)]
    .filter(Boolean)
    .join(' · '),
);
const scheduleSummary = computed(() => {
  const cycle = props.draft.cycleYears === 1
    ? t('due.cycleYearly')
    : t('due.cycleEvery', { years: props.draft.cycleYears });
  return `${cycle} · ${t('trainingForm.summaryWindow', {
    before: props.draft.windowBeforeMonths,
    after: props.draft.windowAfterMonths,
  })}`;
});
// e.g. "2 materials · EN DE" — the count plus the distinct languages that actually carry content.
const materialSummary = computed(() => {
  if (materialCount.value === 0) return t('trainingForm.summaryEmpty');
  const locales = [...new Set(
    (props.draft.materials ?? []).flatMap((m) =>
      m.variants.filter(hasContent).map((v) => v.locale.toUpperCase()),
    ),
  )];
  return [
    t('trainingForm.summaryMaterials', { count: materialCount.value }, materialCount.value),
    locales.join(' '),
  ].filter(Boolean).join(' · ');
});
const questionsSummary = computed(() =>
  questionCount.value === 0
    ? t('trainingForm.summaryEmpty')
    : t('trainingForm.summaryQuestions', { count: questionCount.value }, questionCount.value),
);
// A section that holds nothing reads as a prompt to fill it, not as a neutral count.
const emptyTint = 'bg-amber-100 text-amber-700';

// The first filled language of a localized string, English preferred — for titles and summaries.
// The editor seeds every language with '', so blank strings must fall through, not just missing ones.
const firstText = (lt: LocalizedText): string =>
  (lt.en?.trim() || Object.values(lt).find((v) => v.trim()) || '').trim();

const questionTitle = (q: Question, i: number): string =>
  `${i + 1}. ${firstText(q.text) || t('trainingForm.questionPlaceholder', { n: i + 1 })}`;
const optionsSummary = (q: Question): string =>
  `${t(typeOf(q) === 'single' ? 'trainingForm.typeSingle' : 'trainingForm.typeMultiple')} · ${t('trainingForm.summaryOptions', { count: q.options.length }, q.options.length)} · ${t('trainingForm.summaryCorrect', { count: correctCount(q) })}`;

// Anything just added must be reachable without hunting for it: opening the section and, for a
// question, the new question itself.
watch(questionCount, (now, before) => {
  if (now > before) {
    open.value.questions = true;
    openQuestions.value[now - 1] = true;
  }
});
watch(materialCount, (now, before) => { if (now > before) open.value.material = true; });

// ── answer key ────────────────────────────────────────────────────────────────────────────────────
// A question may have several correct options. The key is kept sorted so it is stable in the payload,
// and never emptied — a question with no correct answer would be unanswerable.
const keyOf = (q: Question): number[] => (q.correctIndices ??= [0]);
const isCorrect = (q: Question, oi: number): boolean => keyOf(q).includes(oi);
const correctCount = (q: Question): number => keyOf(q).length;

function toggleCorrect(q: Question, oi: number): void {
  const key = keyOf(q);
  const at = key.indexOf(oi);
  if (at === -1) key.push(oi);
  else if (key.length > 1) key.splice(at, 1); // keep at least one correct answer
  key.sort((a, b) => a - b);
}

// ── question type ─────────────────────────────────────────────────────────────────────────────────
// 'single' (radio buttons, exactly one correct answer) or 'multiple' (checkboxes). Records saved
// before the field existed have no type and read as 'multiple'; a question can only become single
// while it has exactly one correct answer, so the switch is disabled otherwise.
const typeOf = (q: Question): 'single' | 'multiple' =>
  q.type === 'single' && correctCount(q) === 1 ? 'single' : 'multiple';
const canBeSingle = (q: Question): boolean => correctCount(q) === 1;
const setType = (q: Question, type: 'single' | 'multiple'): void => { q.type = type; };

/** Single-choice answer key: picking an option replaces the previous one. */
function setCorrect(q: Question, oi: number): void {
  q.correctIndices = [oi];
}

// ── materials ─────────────────────────────────────────────────────────────────────────────────────
// A material is a group of per-locale variants (own label + own content per language). For direct
// v-model editing, every draft material is normalized to exactly one variant per configured locale
// (blank rows for the missing ones) — the server drops empty variants on save, so blanks cost
// nothing. Runs whenever a new draft arrives (dialog open) or the locale list loads.
const hasContent = (v: MaterialVariant): boolean => Boolean(v.file) || Boolean(v.url?.trim());

function normalizeMaterials(): void {
  if (!Array.isArray(props.draft.materials)) props.draft.materials = [];
  if (!materialLocales.length) return; // settings not loaded yet — the watcher re-runs
  for (const m of props.draft.materials) {
    const byLocale = new Map(m.variants.map((v) => [v.locale, v]));
    m.variants = materialLocales.map(
      (locale) => byLocale.get(locale) ?? { locale, label: '', url: '' },
    );
  }
  // Questions are localized the same way: seed every configured language on the text and each
  // option, so the per-language inputs can v-model directly. Blanks are dropped by the server.
  for (const q of props.draft.questions ?? []) {
    for (const locale of materialLocales) {
      q.text[locale] ??= '';
      for (const opt of q.options) opt[locale] ??= '';
    }
  }
  // The training's own master data (name/category/description) is localized too — seed it the same
  // way so the Basics per-language inputs can v-model directly.
  for (const locale of materialLocales) {
    props.draft.name[locale] ??= '';
    props.draft.category[locale] ??= '';
    props.draft.description[locale] ??= '';
  }
}
watch([() => props.draft, () => materialLocales], normalizeMaterials, { immediate: true });

// ── reordering ────────────────────────────────────────────────────────────────────────────────────
// Materials, questions and answer options are presented to learners in array order, so the editor
// reorders them with up/down buttons. Like every content edit, a new order is staged as the draft
// on save and reaches learners only when published.
function swapInPlace<T>(arr: T[], i: number, j: number): void {
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function moveMaterial(mi: number, dir: -1 | 1): void {
  const j = mi + dir;
  if (j < 0 || j >= props.draft.materials.length) return;
  swapInPlace(props.draft.materials, mi, j);
}

function moveQuestion(qi: number, dir: -1 | 1): void {
  const j = qi + dir;
  if (j < 0 || j >= props.draft.questions.length) return;
  swapInPlace(props.draft.questions, qi, j);
  // The expanded state is tracked by position — swap it too, so an open question stays open.
  const wasOpen = openQuestions.value[qi] ?? false;
  openQuestions.value[qi] = openQuestions.value[j] ?? false;
  openQuestions.value[j] = wasOpen;
}

function moveOption(q: Question, oi: number, dir: -1 | 1): void {
  const j = oi + dir;
  if (j < 0 || j >= q.options.length) return;
  swapInPlace(q.options, oi, j);
  // The answer key points at option INDICES: remap the two swapped positions so the key keeps
  // marking the same answers (the same rule removeOption applies when an option disappears).
  q.correctIndices = keyOf(q)
    .map((k) => (k === oi ? j : k === j ? oi : k))
    .sort((a, b) => a - b);
}

const blankVariants = (): MaterialVariant[] =>
  materialLocales.map((locale) => ({ locale, label: '', url: '' }));

function addMaterial(): void {
  props.draft.materials.push({ id: '', variants: blankVariants() }); // the server assigns the id
}
function removeMaterial(i: number): void {
  props.draft.materials.splice(i, 1);
}

const materialTitle = (m: Material, i: number): string =>
  m.variants.find((v) => v.label.trim())?.label.trim() || t('trainingForm.materialTitle', { n: i + 1 });

// File content per variant: any file type, uploaded immediately (bytes stored server-side); only
// the returned descriptor lands on the variant and is persisted when the form saves. One hidden
// single-file input serves every row — the clicked row is remembered in `uploadTarget`.
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadTarget = ref<MaterialVariant | null>(null);

function pickFileFor(variant: MaterialVariant): void {
  uploadTarget.value = variant;
  fileInput.value?.click();
}

async function onFilePicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // reset so picking the same file again still fires change
  const variant = uploadTarget.value;
  if (!file || !variant) return;
  uploading.value = true;
  try {
    // Sent as a raw octet-stream body so any type (incl. .json) bypasses the JSON body parser.
    const { data } = await client.post<MaterialFile>('/trainings/materials', file, {
      params: { name: file.name, type: file.type },
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    variant.file = data;
    delete variant.url; // one content per variant — the file replaces the link
    if (!variant.label.trim()) variant.label = data.name;
  } catch {
    toast.error(t('trainingForm.uploadError', { name: file.name }));
  } finally {
    uploading.value = false;
    uploadTarget.value = null;
  }
}

/** Drop a variant's uploaded file; the row falls back to an (empty) url input. */
function removeVariantFile(variant: MaterialVariant): void {
  delete variant.file;
  variant.url = '';
}

// ── SCORM package ─────────────────────────────────────────────────────────────────────────────────
// A training is delivered either by materials + quiz or by an imported SCORM course. The zip is
// uploaded immediately (like material files) and fully validated server-side; only the returned
// packageId lands on the editing copy and is persisted on save (staged into the draft, live after
// publish). Attaching a package is NOT destructive: the questions are kept but unused, and removing
// the package brings them back.
const SCORM_MAX_BYTES = 500 * 1024 * 1024;
const scormPkg = ref<ScormPackageRef | null>(null);
const scormUploading = ref(false);
const scormProgress = ref<number | null>(null);
const scormError = ref<{ code: string; message: string; details: string[] } | null>(null);
const scormAbort = ref<AbortController | null>(null);
const scormInput = ref<HTMLInputElement | null>(null);
const confirmScormRemove = ref(false);

const hasScorm = computed(() => Boolean(props.draft.scormPackageId));
const scormSummary = computed(() =>
  hasScorm.value && scormPkg.value
    ? `SCORM ${scormPkg.value.version} · ${scormPkg.value.title} · ${formatBytes(scormPkg.value.bytes)}`
    : hasScorm.value
      ? 'SCORM'
      : t('trainingForm.summaryEmpty'),
);

// Resolve the attached package's descriptor when an existing training opens (a fresh upload
// already has it in hand). The single-training GET carries the resolved refs for owners.
watch(
  () => [props.draft.id, props.draft.scormPackageId] as const,
  async ([id, pkgId]) => {
    if (!pkgId) {
      scormPkg.value = null;
      return;
    }
    if (scormPkg.value?.packageId === pkgId) return;
    if (!id) return; // a new training only gets a package through the upload below
    try {
      const { data } = await client.get<Training>(`/trainings/${id}`);
      scormPkg.value = data.scormPackages?.draft ?? data.scormPackages?.published ?? null;
    } catch {
      scormPkg.value = null;
    }
  },
  { immediate: true },
);

function pickScormZip(): void {
  scormInput.value?.click();
}

async function onScormPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  scormError.value = null;
  if (!/\.zip$/i.test(file.name)) {
    scormError.value = { code: 'not-zip-file', message: t('trainingForm.scorm.notZip'), details: [] };
    return;
  }
  if (file.size > SCORM_MAX_BYTES) {
    scormError.value = { code: 'too-large', message: t('trainingForm.scorm.tooLarge'), details: [] };
    return;
  }
  scormUploading.value = true;
  scormProgress.value = 0;
  scormAbort.value = new AbortController();
  try {
    // Raw octet-stream like material files; a determinate progress bar — packages run to hundreds
    // of MB, and a spinner is not acceptable UX at that size.
    const { data } = await client.post<ScormPackageRef>('/trainings/scorm-packages', file, {
      params: { name: file.name },
      headers: { 'Content-Type': 'application/octet-stream' },
      signal: scormAbort.value.signal,
      timeout: 0,
      onUploadProgress: (ev) => {
        scormProgress.value = ev.total ? ev.loaded / ev.total : null;
      },
    });
    scormPkg.value = data;
    props.draft.scormPackageId = data.packageId;
  } catch (err: unknown) {
    if (axios.isCancel(err)) return; // the trainer hit Cancel — no error to show
    const body = axios.isAxiosError(err) ? (err.response?.data as { error?: string; code?: string; details?: string[] }) : undefined;
    scormError.value = {
      code: body?.code ?? 'generic',
      message: body?.error ?? t('trainingForm.scorm.error.generic'),
      details: body?.details ?? [],
    };
  } finally {
    scormUploading.value = false;
    scormProgress.value = null;
    scormAbort.value = null;
  }
}

function cancelScormUpload(): void {
  scormAbort.value?.abort();
}

/** Detach the package: an explicit null (kept by JSON) tells the save to clear the WIP reference.
 *  The quiz below comes back to life — removal is the reversible counterpart of attaching. */
function removeScorm(): void {
  props.draft.scormPackageId = null;
  scormPkg.value = null;
  confirmScormRemove.value = false;
}

/** The rejection message for a known code, else the server's own text. */
const scormErrorText = computed(() => {
  if (!scormError.value) return '';
  const key = `trainingForm.scorm.error.${scormError.value.code}`;
  const translated = t(key);
  return translated === key ? scormError.value.message : translated;
});

// The two trainer options live on the package record and apply immediately (they are runtime
// policy, not staged content).
async function patchScormOptions(patch: { completionRule?: string; allowExternal?: boolean }): Promise<void> {
  if (!scormPkg.value) return;
  try {
    const { data } = await client.patch<ScormPackageRef>(
      `/trainings/scorm-packages/${scormPkg.value.packageId}`,
      patch,
    );
    scormPkg.value = data;
  } catch {
    toast.error(t('trainingForm.scorm.optionError'));
  }
}

// Attempt diagnostics — what actually resolves "the package doesn't work" tickets: whether the
// course ever reported a status, wrote data, or terminated cleanly. Loaded on demand.
const scormAttempts = ref<ScormAttemptSummary[] | null>(null);
const scormAttemptsLoading = ref(false);

async function loadScormAttempts(): Promise<void> {
  if (!props.draft.id) return;
  scormAttemptsLoading.value = true;
  try {
    scormAttempts.value = (await client.get<ScormAttemptSummary[]>(`/trainings/${props.draft.id}/scorm-attempts`)).data;
  } catch {
    scormAttempts.value = [];
  } finally {
    scormAttemptsLoading.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Basics -->
    <CollapsibleSection
      :title="t('trainingForm.sectionBasics')"
      :summary="basicsSummary"
      :open="open.basics"
      @toggle="toggle('basics')"
    >
      <template #icon><Info class="h-4 w-4 shrink-0 text-accent" /></template>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <!-- Name/category/description are localized: one input per configured language, each row
             prefixed by the language's flag alone (no code label — the flag names the language for
             assistive tech). Blank languages are dropped on save. -->
        <div class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.name') }}</span>
          <div v-for="loc in materialLocales" :key="loc" class="flex items-center gap-2">
            <span class="flex w-8 shrink-0 items-center">
              <LocaleFlag :code="loc" />
            </span>
            <input v-model="draft.name[loc]" class="bg-input flex-1" :placeholder="t('trainingForm.namePlaceholder')" />
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.category') }}</span>
          <div v-for="loc in materialLocales" :key="loc" class="flex items-center gap-2">
            <span class="flex w-8 shrink-0 items-center">
              <LocaleFlag :code="loc" />
            </span>
            <input v-model="draft.category[loc]" class="bg-input flex-1" :placeholder="t('trainingForm.categoryPlaceholder')" />
          </div>
        </div>
        <div class="flex flex-col gap-1 sm:col-span-2">
          <span class="form-label">{{ t('trainingForm.description') }}</span>
          <div v-for="loc in materialLocales" :key="loc" class="flex items-start gap-2">
            <span class="mt-2.5 flex w-8 shrink-0 items-center">
              <LocaleFlag :code="loc" />
            </span>
            <textarea v-model="draft.description[loc]" rows="2" class="bg-input flex-1 resize-none" />
          </div>
        </div>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.duration') }}</span>
          <input v-model.number="draft.durationMinutes" type="number" min="0" step="5" class="bg-input" />
        </label>
        <label v-if="isAdmin" class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.owner') }}</span>
          <select v-model="draft.ownerId" class="bg-input">
            <option v-for="o in owners" :key="o.id" :value="o.id">{{ o.name }} ({{ o.email }})</option>
          </select>
        </label>
      </div>
    </CollapsibleSection>

    <!-- Schedule: recurrence cycle + due window -->
    <CollapsibleSection
      :title="t('trainingForm.sectionSchedule')"
      :summary="scheduleSummary"
      :open="open.schedule"
      @toggle="toggle('schedule')"
    >
      <template #icon><CalendarClock class="h-4 w-4 shrink-0 text-accent" /></template>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.repeatEvery') }}</span>
          <select v-model.number="draft.cycleYears" class="bg-input">
            <option v-for="y in cycleOptions" :key="y" :value="y">{{ t('trainingForm.yearsOption', { n: y }, y) }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.windowOpens') }}</span>
          <select v-model.number="draft.windowBeforeMonths" class="bg-input">
            <option v-for="m in windowOptions" :key="m" :value="m">{{ t('trainingForm.monthsOption', { n: m }, m) }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.grace') }}</span>
          <select v-model.number="draft.windowAfterMonths" class="bg-input">
            <option v-for="m in windowOptions" :key="m" :value="m">{{ t('trainingForm.monthsOption', { n: m }, m) }}</option>
          </select>
        </label>
      </div>
    </CollapsibleSection>

    <!-- Material: one sub-card per material, one flag-prefixed row per configured language inside it -->
    <CollapsibleSection
      :title="t('trainingForm.material')"
      :summary="materialSummary"
      :summary-class="materialCount === 0 ? emptyTint : undefined"
      :open="open.material"
      @toggle="toggle('material')"
    >
      <template #icon><LinkIcon class="h-4 w-4 shrink-0 text-accent" /></template>

      <p class="mb-2 font-mono text-[11px] text-ink-light">
        {{ t('trainingForm.materialHint') }} {{ t('trainingForm.fileHint') }}
      </p>
      <div class="flex flex-col gap-3">
        <div
          v-for="(m, mi) in draft.materials"
          :key="mi"
          class="rounded-lg border border-line bg-white p-3"
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="flex min-w-0 items-center gap-2">
              <Paperclip class="h-4 w-4 shrink-0 text-accent" />
              <span class="truncate font-sans text-sm font-semibold text-ink">{{ materialTitle(m, mi) }}</span>
            </span>
            <span class="flex shrink-0 items-center gap-1">
              <button
                class="btn-ghost btn-icon"
                :disabled="mi === 0"
                :aria-label="t('trainingForm.moveUp')"
                :title="t('trainingForm.moveUp')"
                data-testid="move-material-up"
                @click="moveMaterial(mi, -1)"
              >
                <ChevronUp class="h-4 w-4" />
              </button>
              <button
                class="btn-ghost btn-icon"
                :disabled="mi === draft.materials.length - 1"
                :aria-label="t('trainingForm.moveDown')"
                :title="t('trainingForm.moveDown')"
                data-testid="move-material-down"
                @click="moveMaterial(mi, 1)"
              >
                <ChevronDown class="h-4 w-4" />
              </button>
              <button
                class="btn-ghost btn-icon"
                :aria-label="t('trainingForm.removeMaterial')"
                :title="t('trainingForm.removeMaterial')"
                @click="removeMaterial(mi)"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </span>
          </div>

          <!-- One row per configured language: flag · label · url-or-file · upload -->
          <div class="flex flex-col gap-1.5">
            <div v-for="v in m.variants" :key="v.locale" class="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <span class="flex w-8 shrink-0 items-center">
                <LocaleFlag :code="v.locale" />
              </span>
              <input v-model="v.label" class="bg-input min-w-[8rem] flex-1" :placeholder="t('trainingForm.labelPlaceholder')" />
              <span v-if="v.file" class="flex min-w-[12rem] flex-[2] items-center gap-2 rounded-lg border border-line bg-bg-primary px-3 py-2">
                <FileText class="h-4 w-4 shrink-0 text-ink-light" />
                <span class="min-w-0 flex-1 truncate font-sans text-sm text-ink" :title="v.file.name">{{ v.file.name }}</span>
                <span class="shrink-0 font-mono text-[11px] text-ink-light">{{ formatBytes(v.file.size) }}</span>
                <button
                  class="btn-ghost btn-icon"
                  :aria-label="t('trainingForm.removeVariantFile')"
                  :title="t('trainingForm.removeVariantFile')"
                  @click="removeVariantFile(v)"
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </span>
              <input v-else v-model="v.url" class="bg-input min-w-[12rem] flex-[2]" :placeholder="t('trainingForm.urlPlaceholder')" />
              <button
                class="btn-ghost btn-icon"
                :disabled="uploading"
                :aria-label="t('trainingForm.uploadForLocale', { locale: v.locale.toUpperCase() })"
                :title="t('trainingForm.uploadForLocale', { locale: v.locale.toUpperCase() })"
                @click="pickFileFor(v)"
              >
                <Loader2 v-if="uploading && uploadTarget === v" class="h-4 w-4 animate-spin" />
                <Upload v-else class="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <input ref="fileInput" type="file" class="hidden" @change="onFilePicked" />
      <button class="btn-ghost btn-sm mt-2" @click="addMaterial">
        <Plus class="h-3.5 w-3.5" /> {{ t('trainingForm.addMaterial') }}
      </button>
    </CollapsibleSection>

    <!-- SCORM package: an imported course that replaces the quiz. -->
    <CollapsibleSection
      :title="t('trainingForm.scorm.section')"
      :summary="scormSummary"
      :open="open.scorm"
      @toggle="toggle('scorm')"
    >
      <template #icon><Package class="h-4 w-4 shrink-0 text-accent" /></template>

      <p class="font-mono text-xs text-ink-muted">{{ t('trainingForm.scorm.hint') }}</p>

      <!-- Upload / progress -->
      <div v-if="scormUploading" class="mt-3 flex items-center gap-3" data-testid="scorm-upload-progress">
        <div class="h-2 flex-1 overflow-hidden rounded-full bg-pastel-slate/40">
          <div
            class="h-full rounded-full bg-accent transition-all"
            :style="{ width: `${Math.round((scormProgress ?? 0) * 100)}%` }"
          />
        </div>
        <span class="font-mono text-xs text-ink-muted">{{ Math.round((scormProgress ?? 0) * 100) }}%</span>
        <button class="btn-ghost btn-sm" @click="cancelScormUpload">{{ t('common.cancel') }}</button>
      </div>
      <div v-else class="mt-3 flex flex-wrap items-center gap-2">
        <button class="btn-ghost btn-sm" data-testid="scorm-upload" @click="pickScormZip">
          <Upload class="h-3.5 w-3.5" />
          {{ hasScorm ? t('trainingForm.scorm.replace') : t('trainingForm.scorm.upload') }}
        </button>
        <template v-if="hasScorm">
          <button v-if="!confirmScormRemove" class="btn-ghost btn-sm" data-testid="scorm-remove" @click="confirmScormRemove = true">
            <Trash2 class="h-3.5 w-3.5" /> {{ t('trainingForm.scorm.remove') }}
          </button>
          <template v-else>
            <span class="font-mono text-xs text-ink-muted">{{ t('trainingForm.scorm.removeConfirm') }}</span>
            <button class="btn-danger btn-sm" data-testid="scorm-remove-confirm" @click="removeScorm">
              {{ t('common.delete') }}
            </button>
            <button class="btn-ghost btn-sm" @click="confirmScormRemove = false">{{ t('common.cancel') }}</button>
          </template>
        </template>
      </div>
      <input ref="scormInput" type="file" accept=".zip" class="hidden" @change="onScormPicked" />

      <!-- Rejection: the server's stable code mapped to a readable reason, details verbatim. -->
      <div v-if="scormError" class="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3" data-testid="scorm-error">
        <p class="flex items-center gap-1.5 font-sans text-xs font-semibold text-rose-700">
          <AlertTriangle class="h-3.5 w-3.5 shrink-0" /> {{ t('trainingForm.scorm.errorTitle') }}
        </p>
        <p class="mt-1 font-mono text-xs text-rose-700">{{ scormErrorText }}</p>
        <ul v-if="scormError.details.length" class="mt-1 list-inside list-disc">
          <li v-for="d in scormError.details" :key="d" class="font-mono text-[11px] text-rose-600">{{ d }}</li>
        </ul>
      </div>

      <!-- Manifest card: every value is manifest-derived (untrusted) and rendered escaped only. -->
      <div v-if="hasScorm && scormPkg" class="mt-3 rounded-lg border border-line bg-pastel-cyan/20 p-4" data-testid="scorm-manifest-card">
        <div class="flex flex-wrap items-center gap-2">
          <span class="pill bg-accent/10 text-accent">SCORM {{ scormPkg.version }}</span>
          <span class="font-sans text-sm font-semibold text-ink">{{ scormPkg.title }}</span>
        </div>
        <dl class="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          <div class="flex justify-between gap-2">
            <dt class="font-mono text-[11px] text-ink-light">{{ t('trainingForm.scorm.entryFile') }}</dt>
            <dd class="truncate font-mono text-[11px] text-ink-muted" :title="scormPkg.entryHref">{{ scormPkg.entryHref }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="font-mono text-[11px] text-ink-light">{{ t('trainingForm.scorm.masteryScore') }}</dt>
            <dd class="font-mono text-[11px] text-ink-muted">
              {{ scormPkg.masteryScore == null ? t('trainingForm.scorm.masteryNone') : `${Math.round(scormPkg.masteryScore * 100)}%` }}
            </dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="font-mono text-[11px] text-ink-light">{{ t('trainingForm.scorm.fileCount') }}</dt>
            <dd class="font-mono text-[11px] text-ink-muted">{{ scormPkg.fileCount }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="font-mono text-[11px] text-ink-light">{{ t('trainingForm.scorm.unpackedSize') }}</dt>
            <dd class="font-mono text-[11px] text-ink-muted">{{ formatBytes(scormPkg.bytes) }}</dd>
          </div>
        </dl>

        <!-- Trainer options — applied immediately (runtime policy, not staged content). -->
        <div class="mt-3 border-t border-line pt-3">
          <p class="form-label">{{ t('trainingForm.scorm.completionRule') }}</p>
          <div class="mt-1 flex flex-col gap-1">
            <label v-for="rule in ['status', 'exit', 'time']" :key="rule" class="flex items-start gap-2">
              <input
                type="radio"
                name="scorm-completion-rule"
                class="mt-0.5 accent-accent"
                :checked="scormPkg.completionRule === rule"
                :data-testid="`scorm-rule-${rule}`"
                @change="patchScormOptions({ completionRule: rule })"
              />
              <span class="font-mono text-xs text-ink-muted">{{ t(`trainingForm.scorm.completionRule_${rule}`) }}</span>
            </label>
          </div>
          <label class="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              class="mt-0.5 accent-accent"
              :checked="scormPkg.allowExternal"
              data-testid="scorm-allow-external"
              @change="patchScormOptions({ allowExternal: ($event.target as HTMLInputElement).checked })"
            />
            <span class="font-mono text-xs text-ink-muted">
              {{ t('trainingForm.scorm.allowExternal') }}
              <span class="block text-amber-700">{{ t('trainingForm.scorm.allowExternalWarning') }}</span>
            </span>
          </label>
        </div>

        <p class="mt-3 font-mono text-[11px] text-ink-light">{{ t('trainingForm.scorm.a11yNotice') }}</p>
        <p class="font-mono text-[11px] text-ink-light">{{ t('trainingForm.scorm.singleLanguageNotice') }}</p>

        <!-- Attempt diagnostics: did the course ever report status/writes/terminate? This answers
             "the package doesn't work" without guessing. Existing trainings only. -->
        <div v-if="draft.id" class="mt-3 border-t border-line pt-3">
          <button class="btn-ghost btn-sm" data-testid="scorm-diagnostics" :disabled="scormAttemptsLoading" @click="loadScormAttempts">
            <Loader2 v-if="scormAttemptsLoading" class="h-3.5 w-3.5 animate-spin" />
            {{ t('trainingForm.scorm.diagLoad') }}
          </button>
          <div v-if="scormAttempts" class="mt-2 overflow-x-auto">
            <p v-if="scormAttempts.length === 0" class="font-mono text-xs text-ink-light">
              {{ t('trainingForm.scorm.diagEmpty') }}
            </p>
            <table v-else class="w-full text-left">
              <thead>
                <tr class="font-mono text-[11px] text-ink-light">
                  <th class="pr-3 font-normal">{{ t('trainingForm.scorm.diagUser') }}</th>
                  <th class="pr-3 font-normal">{{ t('trainingForm.scorm.diagStatus') }}</th>
                  <th class="pr-3 font-normal">{{ t('trainingForm.scorm.diagReported') }}</th>
                  <th class="pr-3 font-normal">{{ t('trainingForm.scorm.diagScore') }}</th>
                  <th class="pr-3 font-normal">{{ t('trainingForm.scorm.diagWrites') }}</th>
                  <th class="font-normal">{{ t('trainingForm.scorm.diagTerminated') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in scormAttempts" :key="a.id" class="border-t border-line font-mono text-[11px] text-ink-muted">
                  <td class="max-w-[16rem] truncate pr-3" :title="a.userEmail">
                    {{ a.userEmail }}<span v-if="a.preview" class="text-ink-light"> · {{ t('session.scorm.preview') }}</span>
                  </td>
                  <td class="pr-3">{{ a.status }}</td>
                  <td class="pr-3">{{ a.completion }} / {{ a.success }}</td>
                  <td class="pr-3">{{ a.scoreScaled == null ? '—' : `${Math.round(a.scoreScaled * 100)}%` }}</td>
                  <td class="pr-3">{{ a.setValuesCount }}</td>
                  <td>{{ a.terminated ? '✓' : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <!-- Questions: each one collapses to a single row, since this is what makes the editor grow.
         With a SCORM package attached the quiz is kept but UNUSED (the course carries its own
         test) — the section is disabled, not emptied: removing the package brings it back. -->
    <CollapsibleSection
      :title="t('trainingForm.questions')"
      :summary="hasScorm ? t('trainingForm.scorm.quizIgnored') : questionsSummary"
      :summary-class="!hasScorm && questionCount === 0 ? emptyTint : undefined"
      :open="open.questions"
      @toggle="toggle('questions')"
    >
      <template #icon><HelpCircle class="h-4 w-4 shrink-0 text-accent" /></template>

      <div v-if="hasScorm" class="mb-3 rounded-lg border border-blue-200 bg-pastel-blue/30 p-3" data-testid="scorm-quiz-disabled">
        <p class="font-mono text-xs text-blue-800">{{ t('trainingForm.scorm.quizDisabled') }}</p>
      </div>

      <div class="flex flex-col gap-2" :class="hasScorm ? 'pointer-events-none opacity-50' : ''">
        <CollapsibleSection
          v-for="(q, qi) in draft.questions"
          :key="qi"
          :title="questionTitle(q, qi)"
          :summary="optionsSummary(q)"
          :open="openQuestions[qi] ?? false"
          @toggle="toggleQuestion(qi)"
        >
          <template #actions>
            <span class="flex items-center gap-1">
              <button
                class="btn-ghost btn-icon"
                :disabled="qi === 0"
                :aria-label="t('trainingForm.moveUp')"
                :title="t('trainingForm.moveUp')"
                data-testid="move-question-up"
                @click="moveQuestion(qi, -1)"
              >
                <ChevronUp class="h-4 w-4" />
              </button>
              <button
                class="btn-ghost btn-icon"
                :disabled="qi === draft.questions.length - 1"
                :aria-label="t('trainingForm.moveDown')"
                :title="t('trainingForm.moveDown')"
                data-testid="move-question-down"
                @click="moveQuestion(qi, 1)"
              >
                <ChevronDown class="h-4 w-4" />
              </button>
              <button
                class="btn-ghost btn-icon"
                :aria-label="t('trainingForm.removeQuestion')"
                :title="t('trainingForm.removeQuestion')"
                @click="$emit('remove-question', qi)"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </span>
          </template>

          <div class="flex flex-col gap-1">
            <span class="form-label">{{ t('trainingForm.questionText') }}</span>
            <!-- One flag-prefixed text input per configured language; blank languages are dropped on save. -->
            <div v-for="loc in materialLocales" :key="loc" class="flex items-center gap-2">
              <span class="flex w-8 shrink-0 items-center">
                <LocaleFlag :code="loc" />
              </span>
              <input v-model="q.text[loc]" class="bg-input flex-1" :placeholder="t('trainingForm.questionPlaceholder', { n: qi + 1 })" />
            </div>
          </div>
          <!-- Question type. A question with several correct answers cannot become single choice —
               the switch is disabled until the key is reduced to exactly one. -->
          <p class="mt-3 font-mono text-[10px] uppercase tracking-wide text-ink-light">
            {{ t('trainingForm.questionType') }}
          </p>
          <div class="mt-1 flex items-center gap-4">
            <label
              class="flex items-center gap-1.5 text-sm"
              :class="canBeSingle(q) ? '' : 'opacity-50'"
              :title="canBeSingle(q) ? undefined : t('trainingForm.needOneToSwitch')"
            >
              <input
                type="radio"
                :name="`qtype-${qi}`"
                :checked="typeOf(q) === 'single'"
                :disabled="!canBeSingle(q)"
                class="accent-accent"
                @change="setType(q, 'single')"
              />
              {{ t('trainingForm.typeSingle') }}
            </label>
            <label class="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                :name="`qtype-${qi}`"
                :checked="typeOf(q) === 'multiple'"
                class="accent-accent"
                @change="setType(q, 'multiple')"
              />
              {{ t('trainingForm.typeMultiple') }}
            </label>
          </div>
          <p class="mt-3 font-mono text-[10px] uppercase tracking-wide text-ink-light">
            {{ typeOf(q) === 'single' ? t('trainingForm.selectCorrectSingle') : t('trainingForm.selectCorrect') }}
          </p>
          <div class="mt-1 flex flex-col gap-2">
            <div v-for="(opt, oi) in q.options" :key="oi" class="flex items-start gap-2">
              <!-- Single choice: exactly one correct answer, picking another replaces it. -->
              <input
                v-if="typeOf(q) === 'single'"
                type="radio"
                :name="`qkey-${qi}`"
                :checked="isCorrect(q, oi)"
                :title="t('trainingForm.markCorrect')"
                class="mt-2.5 accent-accent"
                @change="setCorrect(q, oi)"
              />
              <!-- Several options may be correct; a learner must then select exactly that set. The last
                   remaining correct answer cannot be unticked — a question needs at least one. -->
              <input
                v-else
                type="checkbox"
                :checked="isCorrect(q, oi)"
                :disabled="isCorrect(q, oi) && correctCount(q) === 1"
                :title="isCorrect(q, oi) && correctCount(q) === 1 ? t('trainingForm.needOneCorrect') : t('trainingForm.markCorrect')"
                class="mt-2.5 accent-accent"
                @change="toggleCorrect(q, oi)"
              />
              <!-- One flag-prefixed input per configured language; the option itself (and the answer
                   key) is shared across languages. -->
              <div class="flex flex-1 flex-col gap-1">
                <div v-for="loc in materialLocales" :key="loc" class="flex items-center gap-2">
                  <span class="flex w-8 shrink-0 items-center">
                    <LocaleFlag :code="loc" />
                  </span>
                  <input v-model="opt[loc]" class="bg-input flex-1" :placeholder="t('trainingForm.optionPlaceholder', { n: oi + 1 })" />
                </div>
              </div>
              <span class="mt-1 flex shrink-0 items-center gap-1">
                <button
                  class="btn-ghost btn-icon"
                  :disabled="oi === 0"
                  :aria-label="t('trainingForm.moveUp')"
                  :title="t('trainingForm.moveUp')"
                  data-testid="move-option-up"
                  @click="moveOption(q, oi, -1)"
                >
                  <ChevronUp class="h-3.5 w-3.5" />
                </button>
                <button
                  class="btn-ghost btn-icon"
                  :disabled="oi === q.options.length - 1"
                  :aria-label="t('trainingForm.moveDown')"
                  :title="t('trainingForm.moveDown')"
                  data-testid="move-option-down"
                  @click="moveOption(q, oi, 1)"
                >
                  <ChevronDown class="h-3.5 w-3.5" />
                </button>
                <button
                  class="btn-ghost btn-icon"
                  :disabled="q.options.length <= 2"
                  :aria-label="t('trainingForm.removeOption')"
                  :title="t('trainingForm.removeOption')"
                  @click="$emit('remove-option', q, oi)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          </div>
          <button class="btn-ghost btn-sm mt-2" @click="$emit('add-option', q)">
            <Plus class="h-3 w-3" /> {{ t('trainingForm.addOption') }}
          </button>
        </CollapsibleSection>
      </div>

      <button v-if="!hasScorm" class="btn-ghost btn-sm mt-2" @click="$emit('add-question')">
        <Plus class="h-3.5 w-3.5" /> {{ t('trainingForm.addQuestion') }}
      </button>
    </CollapsibleSection>
  </div>
</template>
