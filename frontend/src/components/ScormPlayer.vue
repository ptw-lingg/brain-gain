<script setup lang="ts">
// The SCORM player: chrome (exit, third-party notice, save indicator, fullscreen) above a
// sandboxed iframe on the CONTENT origin. The bridge itself lives in useScormAttempt (owned by
// SessionPage, passed in — the flush policy must survive this component's teardown ordering);
// this component is presentational plus the iframe plumbing.
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle, Check, Loader2, LogOut, Maximize2, Minimize2, ShieldAlert } from 'lucide-vue-next';
import { SCORM_SANDBOX } from '@/scorm/protocol';
import type { UseScormAttempt } from '@/composables/useScormAttempt';

const props = defineProps<{
  scorm: UseScormAttempt;
  /** max(durationMinutes, 10) minutes with no completion signal → the "not reporting?" nudge. */
  nudgeAfterMinutes: number;
}>();
const emit = defineEmits<{ exit: [] }>();

const { t } = useI18n();
const frameEl = ref<HTMLIFrameElement | null>(null);
const wrapperEl = ref<HTMLElement | null>(null);
const fullscreen = ref(false);
const nudge = ref(false);

onMounted(() => {
  if (frameEl.value) props.scorm.attachFrame(frameEl.value);
  // The classic SCORM support burden: a package that never reports completion. After the nudge
  // window with no signal, tell the learner it may not be reporting — never leave them staring at
  // a screen that will never advance.
  setTimeout(() => {
    if (!props.scorm.completionReady.value) nudge.value = true;
  }, props.nudgeAfterMinutes * 60_000);
});

// Fullscreen on the WRAPPER div, not the iframe, so our chrome (and the exit button) stays
// visible and reachable.
async function toggleFullscreen(): Promise<void> {
  if (!wrapperEl.value) return;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    fullscreen.value = false;
  } else {
    await wrapperEl.value.requestFullscreen();
    fullscreen.value = true;
  }
}

const saveState = computed<'saved' | 'saving' | 'failed' | 'none'>(() => {
  if (props.scorm.saveFailed.value) return 'failed';
  if (props.scorm.dirtyCount.value > 0) return 'saving';
  if (props.scorm.lastSavedAt.value) return 'saved';
  return 'none';
});
const savedTime = computed(() =>
  props.scorm.lastSavedAt.value
    ? props.scorm.lastSavedAt.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '',
);
</script>

<template>
  <div ref="wrapperEl" class="flex flex-col rounded-xl border border-line bg-white shadow-soft">
    <!-- Chrome — BEFORE the iframe in DOM order, so a keyboard user reaches Exit without having to
         escape the frame (a cross-origin frame can trap focus and we cannot even detect it). -->
    <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <button class="btn-ghost btn-sm" data-testid="scorm-exit" @click="emit('exit')">
        <LogOut class="h-3.5 w-3.5" /> {{ t('session.scorm.exit') }}
      </button>
      <span
        class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[11px] text-amber-700"
        :title="t('session.scorm.thirdPartyHint')"
        data-testid="scorm-third-party"
      >
        <ShieldAlert class="h-3 w-3" /> {{ t('session.scorm.thirdParty') }}
      </span>
      <span v-if="scorm.ticket.value?.preview" class="rounded-full bg-pastel-slate/50 px-2 py-0.5 font-mono text-[11px] text-ink-muted">
        {{ t('session.scorm.preview') }}
      </span>
      <span class="flex-1" />
      <!-- The save indicator is honest: "saved" means the server ACKED the write to disk. -->
      <span v-if="saveState === 'saving'" class="inline-flex items-center gap-1 font-mono text-[11px] text-ink-muted" data-testid="scorm-saving">
        <Loader2 class="h-3 w-3 animate-spin" /> {{ t('session.scorm.saving') }}
      </span>
      <span v-else-if="saveState === 'saved'" class="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-600" data-testid="scorm-saved">
        <Check class="h-3 w-3" /> {{ t('session.scorm.saved', { time: savedTime }) }}
      </span>
      <span
        v-else-if="saveState === 'failed'"
        class="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-700"
        :title="t('session.scorm.saveFailedHint')"
        data-testid="scorm-save-failed"
      >
        <AlertTriangle class="h-3 w-3" /> {{ t('session.scorm.saveFailed') }}
      </span>
      <button class="btn-ghost btn-sm" :title="t(fullscreen ? 'session.scorm.exitFullscreen' : 'session.scorm.fullscreen')" @click="toggleFullscreen">
        <Minimize2 v-if="fullscreen" class="h-3.5 w-3.5" />
        <Maximize2 v-else class="h-3.5 w-3.5" />
      </button>
    </div>

    <div v-if="nudge && !scorm.completionReady.value" class="border-b border-blue-200 bg-pastel-blue/30 px-3 py-2">
      <p class="font-mono text-xs text-blue-800">{{ t('session.scorm.noSignalHint') }}</p>
    </div>

    <!-- The frame. sandbox is the shared SCORM_SANDBOX constant — byte-identical to the content
         origin's CSP sandbox directive (asserted in e2e). allow-top-navigation is deliberately
         ABSENT (frame-busting); the pair allow-scripts+allow-same-origin is safe here because the
         frame is on a DIFFERENT origin than the app — see scorm/protocol.ts. -->
    <iframe
      ref="frameEl"
      :src="scorm.ticket.value?.url"
      :sandbox="SCORM_SANDBOX"
      referrerpolicy="no-referrer"
      allow="autoplay 'self'; fullscreen 'self'"
      :title="t('session.scorm.frameTitle')"
      class="block w-full flex-1 rounded-b-xl border-0 bg-white"
      :class="fullscreen ? 'h-full' : 'h-[70vh] min-h-[420px]'"
      data-testid="scorm-frame"
    />
  </div>
</template>
