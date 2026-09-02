<script setup lang="ts">
// The SCORM player: the shared ContentViewer chrome (training title, icon-only controls centred in
// ONE title line, save state on the right) wrapped around the sandboxed iframe on the CONTENT
// origin. The bridge itself lives in useScormAttempt — owned by SessionPage and passed in, because
// the flush policy must survive this component's teardown; here it is only attached to the iframe.
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle, Check, Loader2 } from 'lucide-vue-next';
import ContentViewer from '@/components/ContentViewer.vue';
import { SCORM_SANDBOX } from '@/scorm/protocol';
import type { UseScormAttempt } from '@/composables/useScormAttempt';

const props = defineProps<{
  scorm: UseScormAttempt;
  /** The training title — shown in the viewer's title line. */
  title: string;
  /** max(durationMinutes, 10) minutes with no completion signal → the "not reporting?" nudge. */
  nudgeAfterMinutes: number;
}>();
const emit = defineEmits<{ exit: []; restart: []; finish: [] }>();

const { t } = useI18n();
const nudge = ref(false);

onMounted(() => {
  // The classic SCORM support burden: a package that never reports completion. After the nudge
  // window with no signal, tell the learner it may not be reporting — never leave them staring at
  // a screen that will never advance.
  setTimeout(() => {
    if (!props.scorm.completionReady.value) nudge.value = true;
  }, props.nudgeAfterMinutes * 60_000);
});

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

// The completion control is always on screen but stays disabled until the course reported a result
// AND every write is durably on the server; its tooltip says which of the two is still missing, so
// the learner never has to guess why they cannot finish yet.
const finishHint = computed(() => {
  if (props.scorm.canFinish.value) return t('session.scorm.finishCta');
  if (props.scorm.saveFailed.value) return t('session.scorm.saveFailedHint');
  if (props.scorm.dirtyCount.value > 0) return t('session.scorm.saving');
  return t('session.scorm.notCompletedYet');
});
</script>

<template>
  <ContentViewer
    kind="scorm"
    :title="title"
    :src="scorm.ticket.value?.url"
    :sandbox="SCORM_SANDBOX"
    :frame-title="t('session.scorm.frameTitle')"
    leave="exit"
    :leave-label="t('session.scorm.exit')"
    :restart="{ label: t('session.scorm.startOver'), confirm: t('session.scorm.startOverConfirm') }"
    :preview="scorm.ticket.value?.preview ? t('session.scorm.preview') : null"
    third-party
    @frame="scorm.attachFrame"
    @leave="emit('exit')"
    @restart="emit('restart')"
  >
    <!-- Last in the centred group: the one action with a word on it, because it is the irreversible,
         audited step (SR-173) — the learner must not have to hover to find it. -->
    <template #action>
      <button
        class="btn-primary btn-sm shrink-0"
        :disabled="!scorm.canFinish.value"
        :title="finishHint"
        data-testid="scorm-finish"
        @click="emit('finish')"
      >
        <Check class="h-3.5 w-3.5" /> {{ t('session.scorm.finishShort') }}
      </button>
    </template>

    <!-- Right region: the save indicator is honest — "saved" means the server ACKED the write to
         disk — and keeps its words, since progress safety must be readable without hovering. -->
    <template #status>
      <span
        v-if="saveState === 'saving'"
        class="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-ink-muted"
        data-testid="scorm-saving"
      >
        <Loader2 class="h-3 w-3 animate-spin" />
        <span class="hidden sm:inline">{{ t('session.scorm.saving') }}</span>
      </span>
      <span
        v-else-if="saveState === 'saved'"
        class="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-emerald-600"
        data-testid="scorm-saved"
      >
        <Check class="h-3 w-3" />
        <span class="hidden sm:inline">{{ t('session.scorm.saved', { time: savedTime }) }}</span>
      </span>
      <span
        v-else-if="saveState === 'failed'"
        class="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-700"
        :title="t('session.scorm.saveFailedHint')"
        data-testid="scorm-save-failed"
      >
        <AlertTriangle class="h-3 w-3" />
        <span class="hidden sm:inline">{{ t('session.scorm.saveFailed') }}</span>
      </span>
    </template>

    <!-- Slim notices above the course: whatever the page passes in (a pending update, a resume
         hint), then this player's own "not reporting?" nudge. -->
    <template #notice>
      <slot name="notice" />
      <div
        v-if="nudge && !scorm.completionReady.value"
        class="shrink-0 border-b border-blue-200 bg-pastel-blue/30 px-3 py-1.5"
      >
        <p class="font-mono text-xs text-blue-800">{{ t('session.scorm.noSignalHint') }}</p>
      </div>
    </template>
  </ContentViewer>
</template>
