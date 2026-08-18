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
  Mail,
  PartyPopper,
  RefreshCw,
  XCircle,
} from 'lucide-vue-next';
import axios from 'axios';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { reauthWithEntra, type EntraConfig } from '@/auth/msal';
import LocaleFlag from '@/components/LocaleFlag.vue';
import { formatBytes } from '@/utils/display';
import { downloadFile as saveFile } from '@/utils/download';
import { formatDate } from '@/utils/display';
import { FALLBACK_LOCALE, localeName, resolveLocalized } from '@/utils/locales';
import type { DueTraining, GradeResult, LocalizedText, Material, MaterialFile, MaterialVariant, Settings, TrainerContact, Training, TrainingUpdate } from '@/types';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();
const trainingId = route.params.trainingId as string;

const training = ref<Training | null>(null);
const loading = ref(true);
// 'confirmed' is the closing screen of the confirm-only path: a pending confirm-mode update was
// acknowledged — no quiz, no new session, the regular cycle clock deliberately untouched.
const step = ref<'material' | 'quiz' | 'result' | 'confirmed'>('material');
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

// Whether a test follows the material. Without questions the training is still completable: the
// learner's audited materials confirmation plus an empty grading run (which always passes) are the
// evidence the training was done.
const hasQuestions = computed(() => (training.value?.questions.length ?? 0) > 0);

// Version 0 = no published version yet: the flow is replaced by an "in preparation" notice.
// Learners normally never get here (the dashboard card is not startable); this guards deep links
// and owners previewing their own unpublished training.
const unpublished = computed(() => training.value != null && (training.value.version ?? 1) === 0);

// The materials-awareness confirmation dialog shown before any test starts (SR-162).
const confirmOpen = ref(false);
const confirming = ref(false);

// ── Completion signature (SR-173) ─────────────────────────────────────────────────────────────────
// Completing a training — submitting the test, or confirming a test-less one — requires the learner
// to re-confirm their identity at that moment: their password, or a fresh Microsoft sign-in for
// SSO-linked accounts. The server verifies it against the ACTING account and records the method in
// the audit trail with the completion.
type Reauth = { password: string } | { entraIdToken: string };
const ssoConfig = ref<EntraConfig | null>(null);
const signatureOpen = ref(false); // the quiz path's signature dialog (test-less path signs inline)
const signaturePassword = ref('');
const signing = ref(false); // a Microsoft re-login popup is in flight
const hasPassword = computed(() => auth.user?.hasPassword ?? true);
// A test-less training (outside the confirm-only update path) is COMPLETED by the confirmation,
// so the confirmation dialog itself carries the signature fields.
const completesByConfirmation = computed(() => !hasQuestions.value && !confirmOnly.value);

async function fetchSsoConfig(): Promise<void> {
  try {
    const { data } = await client.get<{ enabled: boolean; clientId?: string; authority?: string }>(
      '/auth/sso/config',
    );
    ssoConfig.value =
      data.enabled && data.clientId && data.authority
        ? { clientId: data.clientId, authority: data.authority }
        : null;
  } catch {
    ssoConfig.value = null;
  }
}

// The owning trainer's contact card (SR-163) — shown in the confirmation dialog and on the result
// screen so a trainee with questions knows exactly whom to ask. null while loading or when the
// owner account no longer exists; the card simply stays hidden then.
const trainer = ref<TrainerContact | null>(null);

// This training's entry from the canonical due view (/trainings/mine) — carries the pending
// training update, if any. null when the training isn't required of this user.
const myDue = ref<DueTraining | null>(null);
// The pending update the learner must act on (status 'updated' only).
const pendingUpdate = computed<TrainingUpdate | null>(() =>
  myDue.value?.status === 'updated' ? myDue.value.pendingUpdate : null,
);
// Confirm-mode: reviewing + confirming the materials clears the update — the quiz is skipped.
// Retake-mode: the normal full flow runs; the new passing session clears the update.
const confirmOnly = computed(() => pendingUpdate.value?.mode === 'confirm');

// Avatar initials from the trainer's name, e.g. "Tom Trainer" → "TT".
const trainerInitials = computed(() =>
  (trainer.value?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join(''),
);

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
 * Resolve a localized string (training name/description, question/answer texts) with the material
 * logic applied per string: chosen language → English → all filled languages joined (so nothing is
 * ever unanswerable). `alternative` marks anything not shown in the chosen language — it drives the
 * badge. Thin wrapper over the shared resolver, bound to this session's content language.
 */
function resolveText(lt: LocalizedText): { value: string; alternative: boolean } {
  return resolveLocalized(lt, chosenLocale.value);
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
  // Best-effort: a missing trainer (deleted account) just hides the contact hint.
  try {
    trainer.value = (await client.get<TrainerContact>(`/trainings/${trainingId}/trainer`)).data;
  } catch {
    trainer.value = null;
  }
  // Best-effort: /mine tells whether a published update is pending for this user. When the call
  // fails (or the training isn't required), the session just runs as a normal full pass.
  try {
    const { data } = await client.get<DueTraining[]>('/trainings/mine');
    myDue.value = data.find((d) => d.training.id === trainingId) ?? null;
  } catch {
    myDue.value = null;
  }
}

function startTest(): void {
  confirmOpen.value = true;
}

// The learner confirmed awareness of all provided materials: record it in the audit trail, then
// start the test — or, when the training has no questions, complete it right away via an empty
// grading run (total 0 → passed), so the confirmation + persisted session are the evidence. That
// completion path requires the completion signature (SR-173), collected inside this dialog.
// For a pending confirm-mode update the confirmation instead carries the updateId: the server
// persists the acknowledgement (clearing the update) and the session ends here — no quiz, no new
// session record, the regular cycle clock untouched.
async function confirmMaterials(reauth?: Reauth): Promise<void> {
  confirming.value = true;
  try {
    const updateId = confirmOnly.value ? pendingUpdate.value!.id : undefined;
    await client.post('/sessions/confirm-materials', { trainingId, ...(updateId ? { updateId } : {}) });
    if (updateId) {
      confirmOpen.value = false;
      step.value = 'confirmed';
    } else if (hasQuestions.value) {
      confirmOpen.value = false;
      step.value = 'quiz';
    } else if (reauth) {
      // The dialog stays open on a rejected signature so the learner can correct the password.
      await submit(reauth);
      if (step.value === 'result') confirmOpen.value = false;
    }
  } catch {
    toast.error(t('session.confirmError'));
  } finally {
    confirming.value = false;
  }
}

// Test-less completion signed via a fresh Microsoft re-login instead of a password.
async function confirmWithMicrosoft(): Promise<void> {
  if (!ssoConfig.value) return;
  signing.value = true;
  try {
    const idToken = await reauthWithEntra(ssoConfig.value);
    await confirmMaterials({ entraIdToken: idToken });
  } catch {
    toast.error(t('session.signature.failed'));
  } finally {
    signing.value = false;
  }
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

// Grade the attempt. Every submission carries the completion signature; a rejected signature (401)
// keeps the signature UI open so the learner can correct their credentials and try again.
async function submit(reauth: Reauth): Promise<void> {
  submitting.value = true;
  try {
    const { data } = await client.post<GradeResult>('/sessions/grade', {
      trainingId,
      answers: answers.value,
      reauth,
    });
    signatureOpen.value = false;
    signaturePassword.value = '';
    result.value = data;
    step.value = 'result';
  } catch (err: unknown) {
    // 403 = the step-up identity confirmation failed (the session itself is fine).
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    toast.error(status === 403 ? t('session.signature.failed') : t('session.signature.error'));
  } finally {
    submitting.value = false;
  }
}

// Quiz submission signed via a fresh Microsoft re-login instead of a password.
async function submitWithMicrosoft(): Promise<void> {
  if (!ssoConfig.value) return;
  signing.value = true;
  try {
    const idToken = await reauthWithEntra(ssoConfig.value);
    await submit({ entraIdToken: idToken });
  } catch {
    toast.error(t('session.signature.failed'));
  } finally {
    signing.value = false;
  }
}

function retry(): void {
  if (training.value) answers.value = Array.from({ length: training.value.questions.length }, () => []);
  result.value = null;
  signaturePassword.value = '';
  step.value = 'quiz';
}

onMounted(() => {
  void load();
  void fetchSsoConfig();
});
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <button class="btn-ghost btn-sm mb-4" @click="router.push('/dashboard')">
      <ArrowLeft class="h-3.5 w-3.5" /> {{ t('session.back') }}
    </button>

    <div v-if="loading" class="card h-64 animate-pulse bg-pastel-slate/30" />

    <template v-else-if="training && unpublished">
      <h1 class="page-title">{{ resolveText(training.name).value }}</h1>
      <div class="card mt-6 flex flex-col items-center gap-3 bg-pastel-slate/20 p-8 text-center" data-testid="session-unpublished">
        <p class="font-mono text-sm text-ink-muted">{{ t('session.inPreparation') }}</p>
        <button class="btn-ghost" @click="router.push('/dashboard')">{{ t('session.backToTrainings') }}</button>
      </div>
    </template>

    <template v-else-if="training">
      <h1 class="page-title">{{ resolveText(training.name).value }}</h1>
      <p class="mt-1 font-mono text-xs text-ink-light">
        {{ t('session.stepOf', { step: step === 'material' ? 1 : step === 'quiz' ? 2 : 3 }) }}
      </p>

      <!-- Step 1: Material -->
      <section v-if="step === 'material'" class="mt-6 flex flex-col gap-4">
        <!-- Pending training update: why this training is back on the list and what clears it. -->
        <div
          v-if="pendingUpdate"
          class="rounded-lg border border-blue-200 bg-pastel-blue/30 p-4"
          data-testid="update-banner"
        >
          <p class="font-sans text-sm font-semibold text-blue-800">
            {{ confirmOnly
              ? t('session.update.confirmBanner', { version: pendingUpdate.version, date: formatDate(pendingUpdate.deadline) })
              : t('session.update.retakeBanner', { version: pendingUpdate.version, date: formatDate(pendingUpdate.deadline) }) }}
          </p>
          <p v-if="pendingUpdate.note" class="mt-1 font-mono text-xs italic text-ink-muted">
            {{ pendingUpdate.note }}
          </p>
        </div>

        <p class="font-mono text-sm text-ink-muted">{{ resolveText(training.description).value }}</p>

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
        <p v-if="!hasQuestions && !confirmOnly" class="font-mono text-xs text-amber-600">{{ t('session.noQuestions') }}</p>
        <button class="btn-primary self-start" data-testid="session-start" @click="startTest">
          {{ confirmOnly
            ? t('session.update.confirmCta')
            : hasQuestions
              ? t('session.startTest')
              : t('session.completeTraining') }}
        </button>

        <!-- Materials-awareness confirmation (SR-162): shown before any test starts. For a training
             without questions this confirmation is the only evidence the training was done, so it is
             recorded in the audit trail before anything else happens. -->
        <div
          v-if="confirmOpen"
          class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          data-testid="confirm-materials-dialog"
        >
          <div class="card w-full max-w-md p-6" role="dialog" aria-modal="true">
            <h2 class="font-sans text-lg font-bold text-ink">{{ t('session.confirmTitle') }}</h2>
            <p class="mt-2 font-mono text-sm text-ink-muted">{{ t('session.confirmText') }}</p>
            <p v-if="!hasQuestions && !confirmOnly" class="mt-2 font-mono text-xs text-amber-600">
              {{ t('session.confirmNoQuizNote') }}
            </p>
            <!-- Completion signature (SR-173): a test-less training is COMPLETED by this
                 confirmation, so the identity re-confirmation happens right here. -->
            <div
              v-if="completesByConfirmation"
              class="mt-4 rounded-lg border border-line bg-pastel-slate/20 p-4"
              data-testid="signature-fields"
            >
              <p class="font-mono text-xs text-ink-muted">{{ t('session.signature.text') }}</p>
              <p class="mt-2 font-mono text-xs font-semibold text-ink">{{ auth.user?.email }}</p>
              <input
                v-if="hasPassword"
                v-model="signaturePassword"
                type="password"
                class="bg-input mt-2"
                :placeholder="t('session.signature.password')"
                data-testid="signature-password"
              />
              <button
                v-if="ssoConfig"
                class="btn-ghost btn-sm mt-2"
                :disabled="confirming || signing"
                data-testid="signature-microsoft"
                @click="confirmWithMicrosoft"
              >
                <Loader2 v-if="signing" class="h-3.5 w-3.5 animate-spin" />
                {{ t('session.signature.microsoft') }}
              </button>
              <p v-if="!hasPassword && !ssoConfig" class="mt-2 font-mono text-xs text-rose-600">
                {{ t('session.signature.unavailable') }}
              </p>
            </div>
            <!-- Trainer contact (SR-163): who to ask before committing to the confirmation. -->
            <div
              v-if="trainer"
              class="mt-4 flex items-start gap-3 rounded-lg border border-petrol-200 bg-gradient-to-br from-pastel-cyan/50 to-white p-4"
              data-testid="trainer-contact"
            >
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent font-sans text-sm font-bold text-white shadow-soft">
                {{ trainerInitials }}
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-mono text-[11px] text-ink-light">{{ t('session.trainerHint') }}</p>
                <p class="mt-0.5 font-sans text-sm font-bold leading-snug text-ink">{{ trainer.name }}</p>
                <p v-if="trainer.orgUnitName" class="font-mono text-xs text-ink-muted">{{ trainer.orgUnitName }}</p>
                <a
                  :href="`mailto:${trainer.email}`"
                  class="mt-1.5 inline-flex items-center gap-1.5 break-all font-mono text-xs font-semibold text-accent hover:underline"
                >
                  <Mail class="h-3.5 w-3.5 shrink-0" /> {{ trainer.email }}
                </a>
              </div>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button class="btn-ghost" :disabled="confirming" @click="confirmOpen = false">
                {{ t('common.cancel') }}
              </button>
              <button
                class="btn-primary"
                :disabled="confirming || signing || (completesByConfirmation && (!hasPassword || !signaturePassword))"
                data-testid="confirm-materials-ok"
                @click="confirmMaterials(completesByConfirmation ? { password: signaturePassword } : undefined)"
              >
                <Loader2 v-if="confirming" class="h-4 w-4 animate-spin" />
                {{ t('session.confirmOk') }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Confirm-only closing screen: the acknowledgement is recorded, nothing else to do. -->
      <section v-else-if="step === 'confirmed'" class="mt-6">
        <div class="card flex flex-col items-center gap-3 bg-pastel-mint/30 p-8 text-center" data-testid="update-confirmed">
          <PartyPopper class="h-12 w-12 text-emerald-500" />
          <h2 class="font-sans text-xl font-bold text-ink">{{ t('session.update.confirmedTitle') }}</h2>
          <p class="font-mono text-sm text-ink-muted">{{ t('session.update.confirmedText') }}</p>
          <button class="btn-ghost mt-2" @click="router.push('/dashboard')">
            {{ t('session.backToTrainings') }}
          </button>
        </div>
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

        <!-- Submitting requires the completion signature — the button opens the identity dialog. -->
        <button class="btn-primary self-start" :disabled="!allAnswered || submitting" @click="signatureOpen = true">
          <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
          {{ submitting ? t('session.grading') : t('session.submitTest') }}
        </button>

        <!-- Completion signature (SR-173): identity re-confirmation gates every submission. -->
        <div
          v-if="signatureOpen"
          class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          data-testid="signature-dialog"
        >
          <div class="card w-full max-w-md p-6" role="dialog" aria-modal="true">
            <h2 class="font-sans text-lg font-bold text-ink">{{ t('session.signature.title') }}</h2>
            <p class="mt-2 font-mono text-sm text-ink-muted">{{ t('session.signature.text') }}</p>
            <p class="mt-3 font-mono text-xs font-semibold text-ink">{{ auth.user?.email }}</p>
            <input
              v-if="hasPassword"
              v-model="signaturePassword"
              type="password"
              class="bg-input mt-2"
              :placeholder="t('session.signature.password')"
              data-testid="signature-password"
              @keydown.enter="signaturePassword && submit({ password: signaturePassword })"
            />
            <p v-if="!hasPassword && !ssoConfig" class="mt-2 font-mono text-xs text-rose-600">
              {{ t('session.signature.unavailable') }}
            </p>
            <div class="mt-5 flex flex-wrap justify-end gap-2">
              <button
                v-if="ssoConfig"
                class="btn-ghost"
                :disabled="submitting || signing"
                data-testid="signature-microsoft"
                @click="submitWithMicrosoft"
              >
                <Loader2 v-if="signing" class="h-4 w-4 animate-spin" />
                {{ t('session.signature.microsoft') }}
              </button>
              <button class="btn-ghost" :disabled="submitting || signing" @click="signatureOpen = false">
                {{ t('common.cancel') }}
              </button>
              <button
                v-if="hasPassword"
                class="btn-primary"
                :disabled="submitting || signing || !signaturePassword"
                data-testid="signature-ok"
                @click="submit({ password: signaturePassword })"
              >
                <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
                {{ t('session.signature.submit') }}
              </button>
            </div>
          </div>
        </div>
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
          <!-- A question-less training passes via the materials confirmation — a "0 of 0 correct"
               score line would be nonsense, so name the confirmation as what completed it. -->
          <p v-if="result.total === 0" class="font-mono text-sm text-ink-muted">
            {{ t('session.completedByConfirmation') }}
          </p>
          <p v-else class="font-mono text-sm text-ink-muted">
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
          <!-- Trainer contact (SR-163): on pass AND fail — questions can follow either outcome. -->
          <div
            v-if="trainer"
            class="flex w-full max-w-md items-start gap-3 rounded-lg border border-petrol-200 bg-white/80 p-4 text-left shadow-soft"
            data-testid="trainer-contact"
          >
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent font-sans text-sm font-bold text-white shadow-soft">
              {{ trainerInitials }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="font-mono text-[11px] text-ink-light">{{ t('session.trainerHint') }}</p>
              <p class="mt-0.5 font-sans text-sm font-bold leading-snug text-ink">{{ trainer.name }}</p>
              <p v-if="trainer.orgUnitName" class="font-mono text-xs text-ink-muted">{{ trainer.orgUnitName }}</p>
              <a
                :href="`mailto:${trainer.email}`"
                class="mt-1.5 inline-flex items-center gap-1.5 break-all font-mono text-xs font-semibold text-accent hover:underline"
              >
                <Mail class="h-3.5 w-3.5 shrink-0" /> {{ trainer.email }}
              </a>
            </div>
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
