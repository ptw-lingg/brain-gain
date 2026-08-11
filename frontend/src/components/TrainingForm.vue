<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, Trash2, Link as LinkIcon, HelpCircle, Paperclip, Upload, Loader2, FileText, Info, CalendarClock } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import CollapsibleSection from '@/components/CollapsibleSection.vue';
import type { MaterialFile, Question, SafeUser, Training } from '@/types';
import { formatBytes } from '@/utils/display';

const { t } = useI18n();
const toast = useToastStore();

const props = defineProps<{
  draft: Training;
  isAdmin: boolean;
  owners: SafeUser[];
}>();

defineEmits<{
  'add-link': [];
  'remove-link': [i: number];
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

const linkCount = computed(() => props.draft.materialLinks?.length ?? 0);
const fileCount = computed(() => props.draft.materialFiles?.length ?? 0);
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
const materialSummary = computed(() =>
  linkCount.value + fileCount.value === 0
    ? t('trainingForm.summaryEmpty')
    : [
        linkCount.value ? t('trainingForm.summaryLinks', { count: linkCount.value }, linkCount.value) : '',
        fileCount.value ? t('trainingForm.summaryFiles', { count: fileCount.value }, fileCount.value) : '',
      ].filter(Boolean).join(' · '),
);
const questionsSummary = computed(() =>
  questionCount.value === 0
    ? t('trainingForm.summaryEmpty')
    : t('trainingForm.summaryQuestions', { count: questionCount.value }, questionCount.value),
);
// A section that holds nothing reads as a prompt to fill it, not as a neutral count.
const emptyTint = 'bg-amber-100 text-amber-700';

const questionTitle = (q: Question, i: number): string =>
  `${i + 1}. ${q.text.trim() || t('trainingForm.questionPlaceholder', { n: i + 1 })}`;
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
watch(linkCount, (now, before) => { if (now > before) open.value.material = true; });
watch(fileCount, (now, before) => { if (now > before) open.value.material = true; });

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

// Material files: any file type is allowed. Each picked file is uploaded immediately (bytes stored
// server-side); only the returned descriptor is kept on the draft and persisted when the form saves.
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

function pickFiles(): void {
  fileInput.value?.click();
}

async function onFilesPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = ''; // reset so picking the same file again still fires change
  if (!files.length) return;
  if (!Array.isArray(props.draft.materialFiles)) props.draft.materialFiles = [];
  uploading.value = true;
  try {
    for (const file of files) {
      try {
        // Sent as a raw octet-stream body so any type (incl. .json) bypasses the JSON body parser.
        const { data } = await client.post<MaterialFile>('/trainings/materials', file, {
          params: { name: file.name, type: file.type },
          headers: { 'Content-Type': 'application/octet-stream' },
        });
        props.draft.materialFiles.push(data);
      } catch {
        toast.error(t('trainingForm.uploadError', { name: file.name }));
      }
    }
  } finally {
    uploading.value = false;
  }
}

function removeFile(i: number): void {
  props.draft.materialFiles.splice(i, 1);
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

    <!-- Material: links to study plus uploaded files -->
    <CollapsibleSection
      :title="t('trainingForm.material')"
      :summary="materialSummary"
      :summary-class="linkCount + fileCount === 0 ? emptyTint : undefined"
      :open="open.material"
      @toggle="toggle('material')"
    >
      <template #icon><LinkIcon class="h-4 w-4 shrink-0 text-accent" /></template>

      <!-- Links -->
      <div class="flex flex-col gap-2">
        <div v-for="(link, i) in draft.materialLinks" :key="i" class="flex flex-wrap gap-2 sm:flex-nowrap">
          <input v-model="link.label" class="bg-input min-w-[8rem] flex-1" :placeholder="t('trainingForm.labelPlaceholder')" />
          <input v-model="link.url" class="bg-input min-w-[12rem] flex-[2]" :placeholder="t('trainingForm.urlPlaceholder')" />
          <button class="btn-ghost btn-icon" :aria-label="t('trainingForm.removeLink')" :title="t('trainingForm.removeLink')" @click="$emit('remove-link', i)">
            <Trash2 class="h-4 w-4" />
          </button>
        </div>
      </div>
      <button class="btn-ghost btn-sm mt-2" @click="$emit('add-link')">
        <Plus class="h-3.5 w-3.5" /> {{ t('trainingForm.addLink') }}
      </button>

      <!-- Files (any type — download only, no preview) -->
      <div class="mt-4 mb-1 flex items-center gap-2">
        <Paperclip class="h-4 w-4 text-accent" />
        <span class="form-label !text-ink">{{ t('trainingForm.files') }}</span>
      </div>
      <p class="mb-2 font-mono text-[11px] text-ink-light">{{ t('trainingForm.fileHint') }}</p>
      <div v-if="draft.materialFiles?.length" class="flex flex-col gap-2">
        <div
          v-for="(file, i) in draft.materialFiles"
          :key="file.id"
          class="flex items-center gap-3 rounded-lg border border-line bg-white px-3 py-2"
        >
          <FileText class="h-4 w-4 shrink-0 text-ink-light" />
          <span class="min-w-0 flex-1 truncate font-sans text-sm text-ink" :title="file.name">{{ file.name }}</span>
          <span class="shrink-0 font-mono text-[11px] text-ink-light">{{ formatBytes(file.size) }}</span>
          <button class="btn-ghost btn-icon" :aria-label="t('trainingForm.removeFile')" :title="t('trainingForm.removeFile')" @click="removeFile(i)">
            <Trash2 class="h-4 w-4" />
          </button>
        </div>
      </div>
      <input ref="fileInput" type="file" multiple class="hidden" @change="onFilesPicked" />
      <button class="btn-ghost btn-sm mt-2" :disabled="uploading" @click="pickFiles">
        <Loader2 v-if="uploading" class="h-3.5 w-3.5 animate-spin" />
        <Upload v-else class="h-3.5 w-3.5" />
        {{ uploading ? t('trainingForm.uploading') : t('trainingForm.addFile') }}
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

          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('trainingForm.questionText') }}</span>
            <input v-model="q.text" class="bg-input" :placeholder="t('trainingForm.questionPlaceholder', { n: qi + 1 })" />
          </label>
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
          <div class="mt-1 flex flex-col gap-1.5">
            <div v-for="(_opt, oi) in q.options" :key="oi" class="flex items-center gap-2">
              <!-- Single choice: exactly one correct answer, picking another replaces it. -->
              <input
                v-if="typeOf(q) === 'single'"
                type="radio"
                :name="`qkey-${qi}`"
                :checked="isCorrect(q, oi)"
                :title="t('trainingForm.markCorrect')"
                class="accent-accent"
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
                class="accent-accent"
                @change="toggleCorrect(q, oi)"
              />
              <input v-model="q.options[oi]" class="bg-input flex-1" :placeholder="t('trainingForm.optionPlaceholder', { n: oi + 1 })" />
              <button
                class="btn-ghost btn-icon"
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
