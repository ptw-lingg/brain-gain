<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, Trash2, Link as LinkIcon, HelpCircle, Paperclip, Upload, Loader2, FileText, Info, CalendarClock, X } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import CollapsibleSection from '@/components/CollapsibleSection.vue';
import LocaleFlag from '@/components/LocaleFlag.vue';
import type { LocalizedText, Material, MaterialFile, MaterialVariant, Question, SafeUser, Training } from '@/types';
import { formatBytes } from '@/utils/display';
import { MATERIAL_LOCALES } from '@/utils/locales';

const { t } = useI18n();
const toast = useToastStore();

const props = defineProps<{
  draft: Training;
  isAdmin: boolean;
  owners: SafeUser[];
}>();

// The fixed content languages — one editable row per language on materials, questions and answers.
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
const open = ref({ basics: true, schedule: false, material: false, questions: false });
const openQuestions = ref<Record<number, boolean>>({});
const toggle = (key: keyof typeof open.value): void => { open.value[key] = !open.value[key]; };
const toggleQuestion = (i: number): void => { openQuestions.value[i] = !openQuestions.value[i]; };

const materialCount = computed(() => props.draft.materials?.length ?? 0);
const questionCount = computed(() => props.draft.questions?.length ?? 0);

// Deliberately not the name — the dialog header already shows it, and repeating it here would put a
// second copy of the training name on the page.
const basicsSummary = computed(() =>
  [props.draft.category?.trim(), t('trainingCard.hours', { hours: props.draft.durationHours })]
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
const firstText = (lt: LocalizedText): string =>
  (lt.en ?? Object.values(lt).find((v) => v.trim()) ?? '').trim();

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
}
watch([() => props.draft, () => materialLocales], normalizeMaterials, { immediate: true });

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
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.name') }}</span>
          <input v-model="draft.name" class="bg-input" :placeholder="t('trainingForm.namePlaceholder')" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.category') }}</span>
          <input v-model="draft.category" class="bg-input" :placeholder="t('trainingForm.categoryPlaceholder')" />
        </label>
        <label class="flex flex-col gap-1 sm:col-span-2">
          <span class="form-label">{{ t('trainingForm.description') }}</span>
          <textarea v-model="draft.description" rows="2" class="bg-input resize-none" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="form-label">{{ t('trainingForm.duration') }}</span>
          <input v-model.number="draft.durationHours" type="number" min="0" step="0.5" class="bg-input" />
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

    <!-- Material: one sub-card per material, one row per configured language inside it -->
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
            <button
              class="btn-ghost btn-icon"
              :aria-label="t('trainingForm.removeMaterial')"
              :title="t('trainingForm.removeMaterial')"
              @click="removeMaterial(mi)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>

          <!-- One row per configured language: flag · label · url-or-file · upload -->
          <div class="flex flex-col gap-1.5">
            <div v-for="v in m.variants" :key="v.locale" class="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <span class="flex w-14 shrink-0 items-center gap-1.5">
                <LocaleFlag :code="v.locale" />
                <span class="font-mono text-[10px] uppercase tracking-wide text-ink-light">{{ v.locale }}</span>
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

    <!-- Questions: each one collapses to a single row, since this is what makes the editor grow -->
    <CollapsibleSection
      :title="t('trainingForm.questions')"
      :summary="questionsSummary"
      :summary-class="questionCount === 0 ? emptyTint : undefined"
      :open="open.questions"
      @toggle="toggle('questions')"
    >
      <template #icon><HelpCircle class="h-4 w-4 shrink-0 text-accent" /></template>

      <div class="flex flex-col gap-2">
        <CollapsibleSection
          v-for="(q, qi) in draft.questions"
          :key="qi"
          :title="questionTitle(q, qi)"
          :summary="optionsSummary(q)"
          :open="openQuestions[qi] ?? false"
          @toggle="toggleQuestion(qi)"
        >
          <template #actions>
            <button
              class="btn-ghost btn-icon"
              :aria-label="t('trainingForm.removeQuestion')"
              :title="t('trainingForm.removeQuestion')"
              @click="$emit('remove-question', qi)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </template>

          <div class="flex flex-col gap-1">
            <span class="form-label">{{ t('trainingForm.questionText') }}</span>
            <!-- One text input per configured language; blank languages are dropped on save. -->
            <div v-for="loc in materialLocales" :key="loc" class="flex items-center gap-2">
              <span class="flex w-14 shrink-0 items-center gap-1.5">
                <LocaleFlag :code="loc" />
                <span class="font-mono text-[10px] uppercase tracking-wide text-ink-light">{{ loc }}</span>
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
              <!-- One input per configured language; the option itself (and the answer key) is shared. -->
              <div class="flex flex-1 flex-col gap-1">
                <div v-for="loc in materialLocales" :key="loc" class="flex items-center gap-2">
                  <span class="flex w-14 shrink-0 items-center gap-1.5">
                    <LocaleFlag :code="loc" />
                    <span class="font-mono text-[10px] uppercase tracking-wide text-ink-light">{{ loc }}</span>
                  </span>
                  <input v-model="opt[loc]" class="bg-input flex-1" :placeholder="t('trainingForm.optionPlaceholder', { n: oi + 1 })" />
                </div>
              </div>
              <button
                class="btn-ghost btn-icon mt-1"
                :disabled="q.options.length <= 2"
                :aria-label="t('trainingForm.removeOption')"
                :title="t('trainingForm.removeOption')"
                @click="$emit('remove-option', q, oi)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <button class="btn-ghost btn-sm mt-2" @click="$emit('add-option', q)">
            <Plus class="h-3 w-3" /> {{ t('trainingForm.addOption') }}
          </button>
        </CollapsibleSection>
      </div>

      <button class="btn-ghost btn-sm mt-2" @click="$emit('add-question')">
        <Plus class="h-3.5 w-3.5" /> {{ t('trainingForm.addQuestion') }}
      </button>
    </CollapsibleSection>
  </div>
</template>
