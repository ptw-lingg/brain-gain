<script setup lang="ts">
// The shared chrome for content BrainGain embeds — the SCORM player and the learning-material
// viewer both use it, so the learner always gets ONE title line, laid out in three regions:
//
//   [ what you are looking at ]      [ every control, icon-only ]      [ status only ]
//
// The controls are centred and carry no labels: the icon plus a tooltip (title + aria-label, so
// assistive tech gets the same words) is enough, and it keeps the line usable when a training name
// is long. Status keeps its words — a learner must be able to tell at a glance that their progress
// is stored, without hovering anything.
//
// Two sizes, one DOM node: normally the viewer fills the app's client area (the page claims it via
// the layout store); "full tab" switches the SAME element to fixed/inset-0 so it covers the browser
// tab. A CLASS toggle on purpose — moving or re-creating the element would reload the iframe, which
// for a SCORM course means losing the running attempt.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ChevronLeft,
  Download,
  Eye,
  ExternalLink,
  LogOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  ShieldAlert,
} from 'lucide-vue-next';
import type { EmbedKind } from '@/utils/embed';

const props = defineProps<{
  /** Left region — the training this content belongs to. */
  title: string;
  /** The specific item within it (material label); optional. */
  subtitle?: string;
  kind: EmbedKind | 'scorm';
  /** Media/iframe source. Absent when the content arrives pre-rendered as `pages`/`text`. */
  src?: string | undefined;
  /** An uploaded PDF, rendered to page images by pdf.js — see the body comment for why. */
  pages?: string[] | null;
  /** An uploaded text file's content, shown as-is. */
  text?: string | null;
  frameTitle: string;
  /** Sandbox tokens for the iframe kinds. Media elements ignore it. */
  sandbox?: string;
  /** Leading control: 'back' returns to a list, 'exit' leaves the training. Absent = no leave control. */
  leave?: 'back' | 'exit' | null;
  /** Tooltip for the leave control. */
  leaveLabel?: string;
  /** Offers "start over", which discards the learner's progress — so it confirms first. */
  restart?: { label: string; confirm: string } | null;
  /** Shows a Download control (uploaded files keep their download path). */
  downloadable?: boolean;
  /** Escape hatch shown whenever the source can also be opened directly — a framed host may refuse. */
  externalUrl?: string | null;
  /** Labels the content as third-party — it is not BrainGain's UI and never asks for credentials. */
  thirdParty?: boolean;
  /** Labels a trainer's trial run, which is never recorded. */
  preview?: string | null;
}>();

const emit = defineEmits<{
  /** The iframe element, once mounted — the SCORM bridge attaches its postMessage plumbing to it. */
  frame: [HTMLIFrameElement];
  leave: [];
  download: [];
  restart: [];
}>();

const { t } = useI18n();
const frameEl = ref<HTMLIFrameElement | null>(null);
const fullTab = ref(false);
const confirmRestart = ref(false);

onMounted(() => {
  if (frameEl.value) emit('frame', frameEl.value);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

// Escape leaves full tab (and closes the restart confirmation) — but only while focus is OUTSIDE the
// content: once focus is inside a cross-origin iframe no keydown reaches us, and we cannot detect
// that. Which is why the toggle stays visible in the title line rather than relying on the key.
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (confirmRestart.value) confirmRestart.value = false;
  else if (fullTab.value) fullTab.value = false;
}

function doRestart(): void {
  confirmRestart.value = false;
  emit('restart');
}
</script>

<template>
  <div
    class="flex flex-col overflow-hidden bg-white"
    :class="fullTab ? 'fixed inset-0 z-50' : 'h-full rounded-xl border border-line shadow-soft'"
    data-testid="content-viewer"
  >
    <!-- THE title line. Before the content in DOM order so a keyboard user reaches these controls
         without having to escape the frame first (a cross-origin frame can trap focus). -->
    <div class="flex shrink-0 items-center gap-2 border-b border-line bg-white px-3 py-2">
      <!-- Left: what is on screen. -->
      <span class="flex min-w-0 flex-1 items-baseline gap-2">
        <span class="truncate font-sans text-sm font-bold text-ink">{{ title }}</span>
        <span v-if="subtitle" class="hidden truncate font-mono text-xs text-ink-muted sm:inline">
          {{ subtitle }}
        </span>
      </span>

      <!-- Middle: every control, icon-only, in reading order — leave, restart, content, full tab,
           and last the completion action a page may pass in. -->
      <span class="flex shrink-0 items-center gap-1">
        <button
          v-if="leave"
          class="btn-ghost btn-sm"
          :title="leaveLabel"
          :aria-label="leaveLabel"
          data-testid="viewer-close"
          @click="emit('leave')"
        >
          <LogOut v-if="leave === 'exit'" class="h-3.5 w-3.5" />
          <ChevronLeft v-else class="h-3.5 w-3.5" />
        </button>

        <!-- Start over discards the learner's progress in the course, so a stray click on an
             icon-only control must not be enough — it asks first. -->
        <span v-if="restart" class="relative">
          <button
            class="btn-ghost btn-sm"
            :title="restart.label"
            :aria-label="restart.label"
            :aria-expanded="confirmRestart"
            data-testid="scorm-start-over"
            @click="confirmRestart = !confirmRestart"
          >
            <RotateCcw class="h-3.5 w-3.5" />
          </button>
          <span
            v-if="confirmRestart"
            class="card absolute left-1/2 top-9 z-50 w-60 -translate-x-1/2 p-3 text-left"
            role="dialog"
            aria-modal="false"
          >
            <span class="block font-mono text-xs text-ink-muted">{{ restart.confirm }}</span>
            <span class="mt-2 flex justify-end gap-2">
              <button class="btn-ghost btn-sm" @click="confirmRestart = false">
                {{ t('common.cancel') }}
              </button>
              <button class="btn-primary btn-sm" data-testid="scorm-start-over-confirm" @click="doRestart">
                {{ restart.label }}
              </button>
            </span>
          </span>
        </span>

        <button
          v-if="downloadable"
          class="btn-ghost btn-sm"
          :title="t('viewer.download')"
          :aria-label="t('viewer.download')"
          data-testid="viewer-download"
          @click="emit('download')"
        >
          <Download class="h-3.5 w-3.5" />
        </button>
        <a
          v-if="externalUrl"
          :href="externalUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-ghost btn-sm"
          :title="t('viewer.openExternal')"
          :aria-label="t('viewer.openExternal')"
          data-testid="viewer-external"
        >
          <ExternalLink class="h-3.5 w-3.5" />
        </a>
        <button
          class="btn-ghost btn-sm"
          :title="t(fullTab ? 'viewer.exitFullTab' : 'viewer.fullTab')"
          :aria-label="t(fullTab ? 'viewer.exitFullTab' : 'viewer.fullTab')"
          :aria-pressed="fullTab"
          data-testid="viewer-full-tab"
          @click="fullTab = !fullTab"
        >
          <Minimize2 v-if="fullTab" class="h-3.5 w-3.5" />
          <Maximize2 v-else class="h-3.5 w-3.5" />
        </button>

        <!-- The page's completion action, last in the group. -->
        <slot name="action" />
      </span>

      <!-- Right: status only. Badges are icons with tooltips; the save state keeps its words. -->
      <span class="flex min-w-0 flex-1 items-center justify-end gap-2">
        <span
          v-if="preview"
          class="shrink-0 rounded-full bg-pastel-slate/50 p-1 text-ink-muted"
          :title="preview"
          :aria-label="preview"
          data-testid="viewer-preview"
        >
          <Eye class="h-3 w-3" />
        </span>
        <span
          v-if="thirdParty"
          class="shrink-0 rounded-full border border-amber-200 bg-amber-50 p-1 text-amber-700"
          :title="t('viewer.thirdPartyHint')"
          :aria-label="t('viewer.thirdParty')"
          data-testid="viewer-third-party"
        >
          <ShieldAlert class="h-3 w-3" />
        </span>
        <slot name="status" />
      </span>
    </div>

    <!-- Slim notices between the title line and the content (a pending update, a resume hint). -->
    <slot name="notice" />

    <!-- The content fills everything that is left. UPLOADED files are rendered by the app itself —
         PDFs as pdf.js page images (the browser's native viewer may be configured to DOWNLOAD
         instead of display, and this keeps uploaded bytes out of a same-origin frame), text inline —
         while media uses native elements (real controls, and X-Frame-Options cannot block them).
         Only LINKS, whose bytes we cannot fetch cross-origin, fall back to an iframe. -->
    <div v-if="pages" class="min-h-0 flex-1 overflow-auto bg-pastel-slate/30 p-4" data-testid="viewer-pages">
      <img
        v-for="(page, i) in pages"
        :key="i"
        :src="page"
        :alt="t('viewer.pageOf', { n: i + 1, total: pages.length })"
        class="mx-auto mb-4 block max-w-full shadow-soft last:mb-0"
      />
    </div>
    <pre
      v-else-if="text != null"
      class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-white p-5 font-mono text-xs text-ink"
      data-testid="viewer-text"
      >{{ text }}</pre
    >
    <video
      v-else-if="kind === 'video'"
      :src="src"
      controls
      controlslist="nodownload"
      class="min-h-0 w-full flex-1 bg-black"
      data-testid="viewer-media"
    />
    <audio v-else-if="kind === 'audio'" :src="src" controls class="w-full p-6" data-testid="viewer-media" />
    <div v-else-if="kind === 'image'" class="min-h-0 flex-1 overflow-auto bg-pastel-slate/30 p-4">
      <img :src="src" :alt="subtitle ?? title" class="mx-auto max-w-full" data-testid="viewer-media" />
    </div>
    <iframe
      v-else
      ref="frameEl"
      :src="src"
      :sandbox="sandbox"
      referrerpolicy="no-referrer"
      allow="autoplay 'self'; fullscreen 'self'"
      :title="frameTitle"
      class="min-h-0 w-full flex-1 border-0 bg-white"
      :data-testid="kind === 'scorm' ? 'scorm-frame' : 'viewer-frame'"
    />

    <!-- Honest footnote for framed content: a host that refuses framing leaves the frame blank and
         there is no way to detect it, so the way out is always on screen. -->
    <p
      v-if="externalUrl && !pages && text == null && kind !== 'video' && kind !== 'audio' && kind !== 'image'"
      class="shrink-0 border-t border-line px-3 py-1.5 font-mono text-[11px] text-ink-light"
    >
      {{ t('viewer.blockedHint') }}
    </p>
  </div>
</template>
