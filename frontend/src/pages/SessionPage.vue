<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  Maximize2,
  PartyPopper,
  RefreshCw,
  XCircle,
} from 'lucide-vue-next';
import axios from 'axios';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useLayoutStore } from '@/stores/layout';
import { useToastStore } from '@/stores/toast';
import { reauthWithEntra, type EntraConfig } from '@/auth/msal';
import ContentViewer from '@/components/ContentViewer.vue';
import LocaleFlag from '@/components/LocaleFlag.vue';
import PasswordInput from '@/components/PasswordInput.vue';
import ScormPlayer from '@/components/ScormPlayer.vue';
import { useScormAttempt } from '@/composables/useScormAttempt';
import { formatBytes } from '@/utils/display';
import { fetchBlobUrl, downloadFile as saveFile } from '@/utils/download';
import { materialSandbox, MEDIA_KINDS, variantEmbedKind, type EmbedKind } from '@/utils/embed';
import { formatDate } from '@/utils/display';
import { FALLBACK_LOCALE, localeName, resolveLocalized } from '@/utils/locales';
import type { DueTraining, GradeResult, LocalizedText, Material, MaterialFile, MaterialVariant, Settings, TrainerContact, Training, TrainingUpdate } from '@/types';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const auth = useAuthStore();
const layout = useLayoutStore();
const toast = useToastStore();
const trainingId = route.params.trainingId as string;

const training = ref<Training | null>(null);
const loading = ref(true);
// 'confirmed' is the closing screen of the confirm-only path: a pending confirm-mode update was
// acknowledged — no quiz, no new session, the regular cycle clock deliberately untouched.
// 'scorm' sits exactly where 'quiz' sits: after the audited materials confirmation, before the
// result — a SCORM-backed training runs its imported course instead of the built-in quiz.
const step = ref<'material' | 'quiz' | 'scorm' | 'result' | 'confirmed'>('material');
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

// A SCORM-backed training: the imported course replaces the quiz. The learner payload carries the
// non-revealing `scorm` summary; the OWNER/ADMIN payload is the raw training instead, which
// carries the published package id — both mean "SCORM-backed", and missing the second one sends
// the owner into the classic empty flow (no material, completable by confirmation) instead of
// their course preview.
const isScorm = computed(() => training.value?.scorm != null || training.value?.scormPackageId != null);
// The bridge/flush state machine — page-scoped so the flush policy survives player teardown and is
// reachable from the signed submission below.
const scorm = useScormAttempt(trainingId, () => training.value?.durationMinutes ?? 10);

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
// so the confirmation dialog itself carries the signature fields. A SCORM training also has no
// questions but is NOT completed here — its course runs first; without the isScorm guard the
// confirmation dialog would complete the whole training without ever launching the package.
const completesByConfirmation = computed(() => !hasQuestions.value && !isScorm.value && !confirmOnly.value);

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
// In confirm-mode the update banner already says the confirmation completes it. A SCORM training
// has no questions either — but a test follows inside the course, so the hint would be a lie.
const showNoQuestionsHint = computed(() => !hasQuestions.value && !isScorm.value && !confirmOnly.value);

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
 * A shown variant that is not in the chosen language gets a language flag — the transparent hint
 * that this is either the English stand-in or one of the languages offered when neither the
 * chosen language nor English exists.
 */
const isAlternative = (v: MaterialVariant): boolean => v.locale !== chosenLocale.value;

/** A variant always has something displayable: its label, else the link/file it carries. */
const variantLabel = (v: MaterialVariant): string => v.label || v.url || v.file?.name || '';

/**
 * Resolve a localized string (training name/description, question/answer texts) with the material
 * logic applied per string: chosen language → English → all filled languages joined (so nothing is
 * ever unanswerable). `alternative` marks anything not shown in the chosen language — it drives the
 * language flag. Thin wrapper over the shared resolver, bound to this session's content language.
 */
function resolveText(lt: LocalizedText): { value: string; alternative: boolean; locale: string | null } {
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
  // A SCORM training has no start step: the course IS the content and there are no materials to
  // review first, so it opens straight away. Anything the removed screen carried (a pending
  // update's deadline and note) rides along as a slim banner above the course instead.
  if (isScorm.value && !unpublished.value && !confirmOnly.value) {
    step.value = 'scorm';
    void scorm.launch();
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

// Save a material file under its original filename, so the learner can open it in their installed
// app. Still the only path for anything the browser cannot render (see utils/embed.ts), and always
// available from the viewer's Download control.
async function downloadFile(file: MaterialFile): Promise<void> {
  try {
    await saveFile(`/trainings/materials/${file.id}`, file.name);
  } catch {
    toast.error(t('session.downloadError'));
  }
}

// ── In-app material viewer ────────────────────────────────────────────────────────────────────────
// Material the browser can render is shown INSIDE the app, filling the whole client area (with a
// full-tab toggle), instead of leaving for a new tab or the downloads folder. What qualifies is
// decided in utils/embed.ts; everything else keeps the old behaviour.
interface OpenMaterial {
  kind: EmbedKind;
  label: string;
  /** Media/iframe source; absent when the content is pre-rendered into `pages`/`text`. */
  src?: string;
  /** An uploaded PDF rendered by pdf.js, one image per page. */
  pages?: string[];
  /** An uploaded text file's content. */
  text?: string;
  /** Set for links: the viewer offers the original URL, since a host may refuse to be framed. */
  externalUrl: string | null;
  /** Set for uploaded files: the viewer keeps a Download control. */
  file: MaterialFile | null;
  sandbox?: string;
  /** A blob: URL we created and must revoke on close. */
  objectUrl: string | null;
}
const viewing = ref<OpenMaterial | null>(null);
const viewerLoading = ref(false);

/**
 * Open a material in the in-app viewer, or fall back to a new tab / download.
 *
 * Uploaded files are rendered by the app itself: their bytes need the auth header anyway, and
 * rendering them here means a PDF displays even when the browser is configured to download PDFs
 * (the same reason utils/pdfPreview.ts exists for controlled documents). Only links — whose bytes
 * we cannot fetch cross-origin — go into a sandboxed iframe.
 */
async function openMaterial(v: MaterialVariant): Promise<void> {
  const kind = variantEmbedKind(v);
  if (!kind) {
    // Not renderable here: a link opens where it works (its own tab), a file downloads.
    if (v.url) window.open(v.url, '_blank', 'noopener,noreferrer');
    else if (v.file) await downloadFile(v.file);
    return;
  }
  const label = variantLabel(v);

  if (v.file) {
    const file = v.file;
    const url = `/trainings/materials/${file.id}`;
    viewerLoading.value = true;
    try {
      const base = { kind, label, externalUrl: null, file, objectUrl: null } as const;
      if (kind === 'pdf') {
        const { data } = await client.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
        // Lazy-imported so pdf.js stays out of the initial bundle (see utils/pdfPreview.ts).
        const { renderPdfToImages } = await import('@/utils/pdfPreview');
        viewing.value = { ...base, pages: await renderPdfToImages(data) };
      } else if (kind === 'text') {
        viewing.value = { ...base, text: (await client.get<string>(url, { responseType: 'text' })).data };
      } else {
        // Media streams from a blob: URL — <video>/<audio>/<img> cannot send the auth header.
        const objectUrl = await fetchBlobUrl(url);
        viewing.value = { ...base, src: objectUrl, objectUrl };
      }
    } catch {
      toast.error(t('session.downloadError'));
    } finally {
      viewerLoading.value = false;
    }
    return;
  }

  const url = v.url!;
  viewing.value = {
    kind,
    label,
    src: url,
    externalUrl: url,
    file: null,
    sandbox: materialSandbox(url),
    objectUrl: null,
  };
}

function closeViewer(): void {
  if (viewing.value?.objectUrl) URL.revokeObjectURL(viewing.value.objectUrl);
  viewing.value = null;
}

/** The viewer and the SCORM player both need the whole client area — claim it while they are up. */
watch(
  () => step.value === 'scorm' || viewing.value !== null,
  (immersive) => {
    layout.immersive = immersive;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  layout.immersive = false;
  if (viewing.value?.objectUrl) URL.revokeObjectURL(viewing.value.objectUrl);
});

// Grade the attempt. Every submission carries the completion signature; a rejected signature (401)
// keeps the signature UI open so the learner can correct their credentials and try again.
// A SCORM training names its server-side attempt and NOTHING else — the score/status live in the
// attempt the server already holds; no result field ever travels from the browser.
async function submit(reauth: Reauth): Promise<void> {
  submitting.value = true;
  try {
    const { data } = await client.post<GradeResult>('/sessions/grade', {
      trainingId,
      ...(isScorm.value
        ? { scormAttemptId: scorm.ticket.value?.attemptId }
        : { answers: answers.value }),
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

// SCORM: "Finish and sign" first flushes everything and REMOVES the third-party content from the
// screen — the signature dialog must never share the viewport with untrusted content (overlay
// phishing) — and only then opens the identity dialog.
async function finishScorm(): Promise<void> {
  await scorm.closeForSigning();
  signatureOpen.value = true;
}

// SCORM: the course reported a definitive FAIL, or the learner wants a clean start — a fresh
// attempt (the old one is abandoned server-side; a failed run's bookmark must not resume onto its
// results screen).
async function retryScorm(): Promise<void> {
  result.value = null;
  signaturePassword.value = '';
  step.value = 'scorm';
  await scorm.launch({ restart: true });
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
  if (isScorm.value) {
    void retryScorm();
    return;
  }
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
  <!-- Embedded content (a SCORM course, a material document) gets the whole client area the page
       claimed from the shell — the 672px reading column is unusable for a 1024px course stage or an
       A4 page. Everything else keeps the comfortable measure. -->
  <div :class="layout.immersive ? 'h-full' : 'mx-auto max-w-2xl'">
    <div v-if="loading" class="card h-64 animate-pulse bg-pastel-slate/30" />

    <template v-else-if="training && unpublished">
      <h1 class="page-title">{{ resolveText(training.name).value }}</h1>
      <div class="card mt-6 flex flex-col items-center gap-3 bg-pastel-slate/20 p-8 text-center" data-testid="session-unpublished">
        <p class="font-mono text-sm text-ink-muted">{{ t('session.inPreparation') }}</p>
        <button class="btn-ghost" @click="router.push('/dashboard')">{{ t('session.backToTrainings') }}</button>
      </div>
    </template>

    <template v-else-if="training">
      <!-- While embedded content is up the training name lives in the viewer's title line instead,
           so the page heading would only repeat it and steal vertical space. -->
      <h1 v-if="!layout.immersive" class="page-title">{{ resolveText(training.name).value }}</h1>

      <!-- A material document/video, filling the client area (full-tab toggle in its title line). -->
      <ContentViewer
        v-if="viewing"
        :kind="viewing.kind"
        :title="resolveText(training.name).value"
        :subtitle="viewing.label"
        :src="viewing.src"
        :pages="viewing.pages"
        :text="viewing.text"
        :sandbox="viewing.sandbox"
        :frame-title="viewing.label"
        :external-url="viewing.externalUrl"
        :downloadable="viewing.file !== null"
        :third-party="viewing.externalUrl !== null"
        leave="back"
        :leave-label="t('viewer.back')"
        @leave="closeViewer"
        @download="viewing.file && downloadFile(viewing.file)"
      />

      <!-- Step 1: Material -->
      <section v-else-if="step === 'material'" class="mt-6 flex flex-col gap-4" data-testid="session-material">
        <!-- One hint box collects whichever notices apply: the pending update (why this training is
             back on the list and what clears it) and the no-test hint. -->
        <div
          v-if="pendingUpdate || showNoQuestionsHint"
          class="rounded-lg border border-blue-200 bg-pastel-blue/30 p-4"
          data-testid="session-hints"
        >
          <template v-if="pendingUpdate">
            <p class="font-sans text-sm font-semibold text-blue-800" data-testid="update-banner">
              {{ confirmOnly
                ? t('session.update.confirmBanner', { date: formatDate(pendingUpdate.deadline) })
                : t('session.update.retakeBanner', { date: formatDate(pendingUpdate.deadline) }) }}
            </p>
            <p v-if="pendingUpdate.note" class="mt-1 font-mono text-xs italic text-ink-muted">
              {{ pendingUpdate.note }}
            </p>
          </template>
          <p v-if="showNoQuestionsHint" class="font-mono text-xs text-ink-muted" :class="pendingUpdate ? 'mt-2' : ''">
            {{ t('session.noQuestions') }}
          </p>
        </div>

        <p class="font-mono text-sm text-ink-muted">{{ resolveText(training.description).value }}</p>

        <div class="flex flex-col gap-3">
          <!-- Per material: the chosen language's variant, the English one as fallback, or — when
               neither exists — every available language. Anything not in the chosen language wears
               its language flag as the transparent hint. -->
          <div v-for="m in training.materials" :key="m.id" class="flex flex-col gap-2">
            <template v-for="v in visibleVariants(m)" :key="`${m.id}-${v.locale}`">
              <!-- Anything the browser renders (an uploaded PDF/video/image, or a link straight to
                   such a file) opens in the in-app viewer, filling the client area. -->
              <button
                v-if="variantEmbedKind(v)"
                type="button"
                class="card flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift"
                :disabled="viewerLoading"
                data-testid="material-open"
                @click="openMaterial(v)"
              >
                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-pastel-sky/60">
                  <Loader2 v-if="viewerLoading" class="h-4 w-4 animate-spin text-accent" />
                  <FileText v-else class="h-4 w-4 text-accent" />
                </div>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-sans text-sm font-semibold text-ink">{{ variantLabel(v) }}</span>
                  <span v-if="v.file" class="font-mono text-[11px] text-ink-light">{{ formatBytes(v.file.size) }}</span>
                </span>
                <LocaleFlag v-if="isAlternative(v)" :code="v.locale" />
                <Maximize2 class="h-4 w-4 shrink-0 text-ink-light" />
              </button>
              <!-- Link variants the browser cannot render in place (a page, an authenticated
                   document viewer) open where they do work: their own tab. -->
              <a
                v-else-if="v.url"
                :href="v.url"
                target="_blank"
                rel="noopener noreferrer"
                class="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lift"
              >
                <div class="flex h-9 w-9 items-center justify-center rounded-md bg-pastel-sky/60">
                  <FileText class="h-4 w-4 text-accent" />
                </div>
                <span class="flex-1 font-sans text-sm font-semibold text-ink">{{ variantLabel(v) }}</span>
                <!-- Only an alternative-language material is flagged; a matching one is unadorned. -->
                <LocaleFlag v-if="isAlternative(v)" :code="v.locale" />
                <ExternalLink class="h-4 w-4 text-ink-light" />
              </a>
              <!-- File variants the browser cannot render download to open in installed apps -->
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
                <LocaleFlag v-if="isAlternative(v)" :code="v.locale" />
                <Download class="h-4 w-4 text-ink-light" />
              </button>
            </template>
          </div>
          <!-- A SCORM package IS the material — "no material" would be misleading. -->
          <p v-if="training.materials.length === 0 && !isScorm" class="font-mono text-xs text-ink-light">
            {{ t('session.noMaterial') }}
          </p>
        </div>
        <!-- The material step is never reached by a SCORM training (its course opens straight away),
             so this button only ever labels the classic paths. -->
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
            <!-- Completion signature (SR-173): a test-less training is COMPLETED by this
                 confirmation, so the identity re-confirmation happens right here — its text also
                 carries the "no test, this confirmation is the evidence" message. Last box, right
                 above the buttons, since it is the field the learner fills before confirming. -->
            <div
              v-if="completesByConfirmation"
              class="mt-4 rounded-lg border border-line bg-pastel-slate/20 p-4"
              data-testid="signature-fields"
            >
              <p class="font-mono text-xs text-ink-muted">{{ t('session.confirmSignatureText') }}</p>
              <p class="mt-2 font-mono text-xs font-semibold text-ink">{{ auth.user?.email }}</p>
              <PasswordInput
                v-if="hasPassword"
                v-model="signaturePassword"
                class="mt-2"
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
      <section v-else-if="step === 'quiz'" class="mt-6 flex flex-col gap-5" data-testid="session-quiz">
        <div
          v-for="(q, qi) in training.questions"
          :key="q.id"
          class="card p-5"
        >
          <p class="flex items-start gap-2 font-sans text-sm font-semibold text-ink">
            <span class="flex-1">{{ qi + 1 }}. {{ resolveText(q.text).value }}</span>
            <!-- A question not shown in the chosen language wears the shown language's flag; only
                 a genuinely mixed joined fallback has no single language and stays unflagged. -->
            <LocaleFlag
              v-if="resolveText(q.text).alternative && resolveText(q.text).locale"
              :code="resolveText(q.text).locale ?? ''"
            />
          </p>
          <!-- Single choice gets radios (exactly one answer, picking another replaces it). Everything
               else is multi-select: one or more options may be correct, and the payload deliberately
               does not say how many, so the control must not reveal it either — the control type is
               the only hint. The `?? 'multiple'` fallback matters for owners/admins, who receive the
               raw training without computed type. -->
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
      </section>

      <!-- Step 2 (SCORM): the imported course replaces the quiz. -->
      <section v-else-if="step === 'scorm'" class="flex h-full flex-col gap-2 p-2" data-testid="session-scorm">
        <div v-if="scorm.phase.value === 'error'" class="card flex flex-col items-center gap-3 bg-rose-50 p-8 text-center" data-testid="scorm-error">
          <XCircle class="h-10 w-10 text-rose-500" />
          <p class="font-mono text-sm text-ink-muted">
            {{ scorm.fatal.value === 'origin-mismatch'
              ? t('session.scorm.misconfigured')
              : scorm.fatal.value === 'expired'
                ? t('session.scorm.expired')
                : t('session.scorm.launchFailed') }}
          </p>
          <button class="btn-ghost" @click="router.push('/dashboard')">{{ t('session.backToTrainings') }}</button>
        </div>

        <!-- Signing is underway: the player (and its third-party iframe) was torn down by
             closeForSigning BEFORE the signature dialog opened, so credentials are never typed with
             untrusted content on screen. -->
        <div v-else-if="scorm.phase.value === 'done'" class="card h-24 animate-pulse bg-pastel-slate/30" />

        <!-- No ticket yet: the launch call is in flight. -->
        <div v-else-if="!scorm.ticket.value" class="card h-64 animate-pulse bg-pastel-slate/30" />

        <!-- The player renders as soon as the ticket exists — its iframe must be in the DOM for the
             wrapper handshake to complete (the handshake is what advances the phase to 'running'). -->
        <!-- Every control lives in the player's title line; the slim banners below it carry what the
             removed start screen used to say. -->
        <ScormPlayer
          v-else
          :scorm="scorm"
          :title="resolveText(training.name).value"
          :nudge-after-minutes="Math.max(training.durationMinutes || 0, 10)"
          class="min-h-0 flex-1"
          @exit="router.push('/dashboard')"
          @restart="retryScorm"
          @finish="finishScorm"
        >
          <template #notice>
            <!-- The obligation the removed start screen carried: why this training is back on the
                 list and by when it must be redone, plus the trainer's note. -->
            <div
              v-if="pendingUpdate"
              class="shrink-0 border-b border-blue-200 bg-pastel-blue/30 px-3 py-1.5"
              data-testid="update-banner"
            >
              <p class="font-mono text-xs text-blue-800">
                {{ t('session.update.retakeBanner', { date: formatDate(pendingUpdate.deadline) }) }}
                <span v-if="pendingUpdate.note" class="italic text-ink-muted"> · {{ pendingUpdate.note }}</span>
              </p>
            </div>
            <!-- A definitive FAIL from the course: nothing to sign — start over for a fresh run
                 (the title line's restart control does it, and asks first). -->
            <div
              v-if="scorm.success.value === 'failed'"
              class="shrink-0 border-b border-rose-200 bg-rose-50 px-3 py-1.5"
              data-testid="scorm-failed"
            >
              <p class="font-mono text-xs text-rose-700">{{ t('session.scorm.courseFailed') }}</p>
            </div>
            <div
              v-else-if="scorm.ticket.value?.resumed"
              class="shrink-0 border-b border-blue-200 bg-pastel-blue/30 px-3 py-1.5"
              data-testid="scorm-resume-banner"
            >
              <p class="font-mono text-xs text-blue-800">{{ t('session.scorm.resumeBanner') }}</p>
            </div>
          </template>
        </ScormPlayer>
      </section>

      <!-- Step 3: Result -->
      <section v-else-if="step === 'result' && result" class="mt-6" data-testid="session-result">
        <div
          class="card flex flex-col items-center gap-3 p-8 text-center"
          :class="result.passed ? 'bg-pastel-mint/30' : 'bg-rose-50'"
        >
          <PartyPopper v-if="result.passed" class="h-12 w-12 text-emerald-500" />
          <XCircle v-else class="h-12 w-12 text-rose-500" />
          <h2 class="font-sans text-xl font-bold text-ink">
            {{ result.passed ? t('session.passed') : t('session.notPassed') }}
          </h2>
          <!-- SCORM: the course reported the score — there is no "N of M questions" to show. -->
          <p v-if="isScorm" class="font-mono text-sm text-ink-muted" data-testid="scorm-result-score">
            {{ t('session.scorm.resultScore', { pct: Math.round(result.scorePct * 100), threshold: thresholdPct }) }}
          </p>
          <!-- A question-less training passes via the materials confirmation — a "0 of 0 correct"
               score line would be nonsense, so name the confirmation as what completed it. -->
          <p v-else-if="result.total === 0" class="font-mono text-sm text-ink-muted">
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

      <!-- Completion signature (SR-173): identity re-confirmation gates every submission. Shared
           between the quiz and SCORM paths — for SCORM it opens only AFTER the third-party frame
           was torn down (finishScorm), so credentials are never typed with untrusted content on
           screen. -->
      <div
        v-if="signatureOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
        data-testid="signature-dialog"
      >
        <div class="card w-full max-w-md p-6" role="dialog" aria-modal="true">
          <h2 class="font-sans text-lg font-bold text-ink">{{ t('session.signature.title') }}</h2>
          <p class="mt-2 font-mono text-sm text-ink-muted">{{ t('session.signature.text') }}</p>
          <p class="mt-3 font-mono text-xs font-semibold text-ink">{{ auth.user?.email }}</p>
          <PasswordInput
            v-if="hasPassword"
            v-model="signaturePassword"
            class="mt-2"
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
    </template>
  </div>
</template>
