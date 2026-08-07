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
import { useToastStore } from '@/stores/toast';
import { formatBytes } from '@/utils/display';
import { downloadFile as saveFile } from '@/utils/download';
import type { GradeResult, MaterialFile, Training } from '@/types';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const toast = useToastStore();
const trainingId = route.params.trainingId as string;

const training = ref<Training | null>(null);
const loading = ref(true);
const step = ref<'material' | 'quiz' | 'result'>('material');
const answers = ref<number[]>([]);
const submitting = ref(false);
const result = ref<GradeResult | null>(null);

const allAnswered = computed(
  () =>
    training.value != null &&
    training.value.questions.length > 0 &&
    answers.value.length === training.value.questions.length &&
    answers.value.every((a) => a >= 0),
);

const thresholdPct = computed(() =>
  result.value ? Math.round(result.value.passThreshold * 100) : 80,
);

// No questions means there is no test to take — the training can't be completed.
const hasQuestions = computed(() => (training.value?.questions.length ?? 0) > 0);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await client.get<Training>(`/trainings/${trainingId}`);
    training.value = data;
    answers.value = new Array(data.questions.length).fill(-1);
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
  if (training.value) answers.value = new Array(training.value.questions.length).fill(-1);
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
        <div class="flex flex-col gap-2">
          <!-- Links open in a new tab -->
          <a
            v-for="(link, i) in training.materialLinks"
            :key="`l-${i}`"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            class="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div class="flex h-9 w-9 items-center justify-center rounded-md bg-pastel-sky/60">
              <FileText class="h-4 w-4 text-accent" />
            </div>
            <span class="flex-1 font-sans text-sm font-semibold text-ink">{{ link.label }}</span>
            <ExternalLink class="h-4 w-4 text-ink-light" />
          </a>
          <!-- Files download to open in the learner's installed apps -->
          <button
            v-for="file in training.materialFiles ?? []"
            :key="`f-${file.id}`"
            type="button"
            class="card flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift"
            @click="downloadFile(file)"
          >
            <div class="flex h-9 w-9 items-center justify-center rounded-md bg-pastel-mint/60">
              <FileText class="h-4 w-4 text-accent" />
            </div>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-sans text-sm font-semibold text-ink">{{ file.name }}</span>
              <span class="font-mono text-[11px] text-ink-light">{{ formatBytes(file.size) }}</span>
            </span>
            <Download class="h-4 w-4 text-ink-light" />
          </button>
          <p
            v-if="training.materialLinks.length === 0 && (training.materialFiles?.length ?? 0) === 0"
            class="font-mono text-xs text-ink-light"
          >
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
          <p class="font-sans text-sm font-semibold text-ink">{{ qi + 1 }}. {{ q.text }}</p>
          <div class="mt-3 flex flex-col gap-2">
            <label
              v-for="(opt, oi) in q.options"
              :key="oi"
              class="check-card"
              :class="answers[qi] === oi ? 'border-accent bg-accent-light/30' : ''"
            >
              <input
                v-model.number="answers[qi]"
                type="radio"
                :name="`q-${q.id}`"
                :value="oi"
                class="accent-accent"
              />
              {{ opt }}
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
