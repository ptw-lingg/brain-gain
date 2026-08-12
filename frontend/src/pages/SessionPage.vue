<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  PartyPopper,
  RefreshCw,
  XCircle,
} from 'lucide-vue-next';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import LocaleFlag from '@/components/LocaleFlag.vue';
import { formatBytes } from '@/utils/display';
import { downloadFile as saveFile } from '@/utils/download';
import { FALLBACK_LOCALE, localeName } from '@/utils/locales';
import type { GradeResult, LocalizedText, Material, MaterialFile, MaterialVariant, Settings, Training } from '@/types';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();
const trainingId = route.params.trainingId as string;

const training = ref<Training | null>(null);
const loading = ref(true);
const step = ref<'material' | 'quiz' | 'result'>('material');
// One selection set per question — a question may have several correct options, so the answer is a set
// of option indices rather than a single index.
const answers = ref<number[][]>([]);
const submitting = ref(false);
const result = ref<GradeResult | null>(null);

const isSelected = (qi: number, oi: number): boolean => answers.value[qi]?.includes(oi) ?? false;

function toggleAnswer(qi: number, oi: number): void {
  const selection = answers.value[qi] ?? (answers.value[qi] = []);
  const at = selection.indexOf(oi);
  if (at === -1) selection.push(oi);
  else selection.splice(at, 1);
  selection.sort((a, b) => a - b);
}

// Single-choice questions: picking an option replaces the previous selection (radio semantics), but
// the answer is still submitted as a one-element set so grading stays uniform.
function selectAnswer(qi: number, oi: number): void {
  answers.value[qi] = [oi];
}

// Every question needs at least one ticked option before the test can be submitted.
const allAnswered = computed(
  () =>
    training.value != null &&
    training.value.questions.length > 0 &&
    answers.value.length === training.value.questions.length &&
    answers.value.every((selection) => selection.length > 0),
);

const thresholdPct = computed(() =>
  result.value ? Math.round(result.value.passThreshold * 100) : 80,
);

// No questions means there is no test to take — the training can't be completed.
const hasQuestions = computed(() => (training.value?.questions.length ?? 0) > 0);

// ── content language ──────────────────────────────────────────────────────────────────────────────
// The session content follows the UI language — the language switch in the user menu is the ONE
// place a user changes language. Resolution is PER MATERIAL/string: the current language's version,
// or the English one when it is missing — and when English is missing too, every version is offered.
const { locale: uiLocale } = useI18n();
const chosenLocale = computed<string>(() => uiLocale.value);

function visibleVariants(m: Material): MaterialVariant[] {
  const chosen = m.variants.find((v) => v.locale === chosenLocale.value);
  if (chosen) return [chosen];
  const fallback = m.variants.find((v) => v.locale === FALLBACK_LOCALE);
  if (fallback) return [fallback];
  return m.variants;
}

/**
 * A shown variant that is not in the chosen language gets an "alternative language" badge — the
 * transparent hint that this is either the English stand-in or one of the languages offered when
 * neither the chosen language nor English exists.
 */
const isAlternative = (v: MaterialVariant): boolean => v.locale !== chosenLocale.value;

/** A variant always has something displayable: its label, else the link/file it carries. */
const variantLabel = (v: MaterialVariant): string => v.label || v.url || v.file?.name || '';

/**
 * Resolve a localized question/answer string with the material logic applied per string:
 * chosen language → English → all filled languages joined (so nothing is ever unanswerable).
 * `alternative` marks anything not shown in the chosen language — it drives the badge.
 */
function resolveText(lt: LocalizedText): { value: string; alternative: boolean } {
  const chosen = lt[chosenLocale.value];
  if (chosen) return { value: chosen, alternative: false };
  const fallback = lt[FALLBACK_LOCALE];
  if (fallback) return { value: fallback, alternative: true };
  return { value: Object.values(lt).filter(Boolean).join(' / '), alternative: true };
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await client.get<Training>(`/trainings/${trainingId}`);
    training.value = data;
    answers.value = Array.from({ length: data.questions.length }, () => []);
  } finally {
    loading.value = false;
  }
}

function startTest(): void {
  step.value = 'quiz';
}

// Material files are download-only (no in-app preview). Fetch the bytes with the auth header, then
// save under the original filename so the learner can open it in their installed app.
async function downloadFile(file: MaterialFile): Promise<void> {
  try {
    await saveFile(`/trainings/materials/${file.id}`, file.name);
  } catch {
    toast.error(t('session.downloadError'));
  }
}

async function submit(): Promise<void> {
  submitting.value = true;
  try {
    const { data } = await client.post<GradeResult>('/sessions/grade', {
      trainingId,
      answers: answers.value,
    });
    result.value = data;
    step.value = 'result';
  } finally {
    submitting.value = false;
  }
}

function retry(): void {
  if (training.value) answers.value = Array.from({ length: training.value.questions.length }, () => []);
  result.value = null;
  step.value = 'quiz';
}

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <button class="btn-ghost btn-sm mb-4" @click="router.push('/dashboard')">
      <ArrowLeft class="h-3.5 w-3.5" /> {{ t('session.back') }}
    </button>

    <div v-if="loading" class="card h-64 animate-pulse bg-pastel-slate/30" />

    <template v-else-if="training">
      <h1 class="page-title">{{ training.name }}</h1>
      <p class="mt-1 font-mono text-xs text-ink-light">
        {{ t('session.stepOf', { step: step === 'material' ? 1 : step === 'quiz' ? 2 : 3 }) }}
      </p>

      <!-- Step 1: Material -->
      <section v-if="step === 'material'" class="mt-6 flex flex-col gap-4">
        <p class="font-mono text-sm text-ink-muted">{{ training.description }}</p>

        <div class="flex flex-col gap-3">
          <!-- Per material: the chosen language's variant, the English one as fallback, or — when
               neither exists — every available language. Anything not in the chosen language wears
               an "alternative language" badge as the transparent hint. -->
          <div v-for="m in training.materials" :key="m.id" class="flex flex-col gap-2">
            <template v-for="v in visibleVariants(m)" :key="`${m.id}-${v.locale}`">
              <!-- Link variants open in a new tab -->
              <a
                v-if="v.url"
                :href="v.url"
                target="_blank"
                rel="noopener noreferrer"
                class="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lift"
              >
                <div class="flex h-9 w-9 items-center justify-center rounded-md bg-pastel-sky/60">
                  <FileText class="h-4 w-4 text-accent" />
                </div>
                <span class="flex-1 font-sans text-sm font-semibold text-ink">{{ variantLabel(v) }}</span>
                <!-- Only an alternative-language material is marked (badge + flag); a matching one is unadorned. -->
                <template v-if="isAlternative(v)">
                  <span class="pill shrink-0 bg-amber-100 text-amber-700">{{ t('session.altLanguage') }}</span>
                  <LocaleFlag :code="v.locale" />
                </template>
                <ExternalLink class="h-4 w-4 text-ink-light" />
              </a>
              <!-- File variants download to open in the learner's installed apps -->
              <button
                v-else-if="v.file"
                type="button"
                class="card flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift"
                @click="downloadFile(v.file)"
              >
                <div class="flex h-9 w-9 items-center justify-center rounded-md bg-pastel-mint/60">
                  <FileText class="h-4 w-4 text-accent" />
                </div>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-sans text-sm font-semibold text-ink">{{ variantLabel(v) }}</span>
                  <span class="font-mono text-[11px] text-ink-light">{{ formatBytes(v.file.size) }}</span>
                </span>
                <template v-if="isAlternative(v)">
                  <span class="pill shrink-0 bg-amber-100 text-amber-700">{{ t('session.altLanguage') }}</span>
                  <LocaleFlag :code="v.locale" />
                </template>
                <Download class="h-4 w-4 text-ink-light" />
              </button>
            </template>
          </div>
          <p v-if="training.materials.length === 0" class="font-mono text-xs text-ink-light">
            {{ t('session.noMaterial') }}
          </p>
        </div>
        <p v-if="!hasQuestions" class="font-mono text-xs text-amber-600">{{ t('session.noQuestions') }}</p>
        <button
          class="btn-primary self-start"
          :disabled="!hasQuestions"
          :title="hasQuestions ? '' : t('session.testUnavailable')"
          @click="startTest"
        >
          {{ t('session.startTest') }}
        </button>
      </section>

      <!-- Step 2: Quiz -->
      <section v-else-if="step === 'quiz'" class="mt-6 flex flex-col gap-5">
        <div
          v-for="(q, qi) in training.questions"
          :key="q.id"
          class="card p-5"
        >
          <p class="flex items-start gap-2 font-sans text-sm font-semibold text-ink">
            <span class="flex-1">{{ qi + 1 }}. {{ resolveText(q.text).value }}</span>
            <span v-if="resolveText(q.text).alternative" class="pill shrink-0 bg-amber-100 text-amber-700">
              {{ t('session.altLanguage') }}
            </span>
          </p>
          <!-- Single choice gets radios (exactly one answer, picking another replaces it). Everything
               else is multi-select: one or more options may be correct, and the payload deliberately
               does not say how many, so the control must not reveal it either. The `?? 'multiple'`
               fallback matters for owners/admins, who receive the raw training without computed type. -->
          <p class="mt-1 font-mono text-[11px] text-ink-light">
            {{ (q.type ?? 'multiple') === 'single' ? t('session.selectOne') : t('session.selectAllThatApply') }}
          </p>
          <div class="mt-3 flex flex-col gap-2">
            <label
              v-for="(opt, oi) in q.options"
              :key="oi"
              class="check-card"
              :class="isSelected(qi, oi) ? 'border-accent bg-accent-light/30' : ''"
            >
              <input
                v-if="(q.type ?? 'multiple') === 'single'"
                type="radio"
                :name="`q-${qi}`"
                :checked="isSelected(qi, oi)"
                class="accent-accent"
                @change="selectAnswer(qi, oi)"
              />
              <input
                v-else
                type="checkbox"
                :checked="isSelected(qi, oi)"
                class="accent-accent"
                @change="toggleAnswer(qi, oi)"
              />
              {{ resolveText(opt).value }}
            </label>
          </div>
        </div>

        <button class="btn-primary self-start" :disabled="!allAnswered || submitting" @click="submit">
          <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
          {{ submitting ? t('session.grading') : t('session.submitTest') }}
        </button>
      </section>

      <!-- Step 3: Result -->
      <section v-else-if="step === 'result' && result" class="mt-6">
        <div
          class="card flex flex-col items-center gap-3 p-8 text-center"
          :class="result.passed ? 'bg-pastel-mint/30' : 'bg-rose-50'"
        >
          <PartyPopper v-if="result.passed" class="h-12 w-12 text-emerald-500" />
          <XCircle v-else class="h-12 w-12 text-rose-500" />
          <h2 class="font-sans text-xl font-bold text-ink">
            {{ result.passed ? t('session.passed') : t('session.notPassed') }}
          </h2>
          <p class="font-mono text-sm text-ink-muted">
            {{ t('session.score', {
              pct: Math.round(result.scorePct * 100),
              correct: result.correct,
              total: result.total,
              threshold: thresholdPct,
            }) }}
          </p>
          <!-- Only present when the admin enabled revealWrongQuestions AND the attempt failed;
               the server names the question indices, never the correct answers. -->
          <div
            v-if="!result.passed && result.wrongIndices?.length && training"
            class="w-full max-w-md rounded-lg border border-rose-200 bg-white/60 p-4 text-left"
          >
            <p class="font-mono text-[11px] uppercase tracking-wide text-rose-600">
              {{ t('session.wrongQuestions') }}
            </p>
            <ul class="mt-2 flex flex-col gap-1">
              <li
                v-for="qi in result.wrongIndices"
                :key="qi"
                class="font-mono text-xs text-ink-muted"
              >
                {{ qi + 1 }}. {{ training.questions[qi] ? resolveText(training.questions[qi].text).value : '' }}
              </li>
            </ul>
          </div>
          <div class="mt-2 flex gap-2">
            <button v-if="!result.passed" class="btn-primary" @click="retry">
              <RefreshCw class="h-4 w-4" /> {{ t('session.retry') }}
            </button>
            <button class="btn-ghost" @click="router.push('/dashboard')">
              {{ t('session.backToTrainings') }}
            </button>
          </div>
          <p v-if="!result.passed" class="mt-1 font-mono text-[11px] text-ink-light">
            {{ t('session.failNote') }}
          </p>
        </div>
      </section>
    </template>
  </div>
</template>
