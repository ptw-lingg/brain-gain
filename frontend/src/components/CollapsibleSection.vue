<script setup lang="ts">
// A titled, collapsible block: header row (icon · title · summary badge · actions · chevron) over a body
// that folds away. Used to group the training editor so an author is never faced with the whole record
// at once — the summary badge keeps the hidden content visible at a glance.
//
// The body is hidden with v-show, not v-if: it stays mounted so a collapsed section keeps its DOM (the
// hidden file input in the material section is addressed directly, and collapsed ≠ absent).
import { ChevronDown } from 'lucide-vue-next';

defineProps<{
  title: string;
  summary?: string;
  open: boolean;
  /** Tint for the summary badge; defaults to the neutral pill. */
  summaryClass?: string;
}>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <!-- Deliberately not the `card` class: that selects list rows elsewhere, and these are inner panels
       of a dialog, not cards in a list. -->
  <div class="overflow-hidden rounded-lg border border-line bg-white">
    <!-- The toggle is its own button so the actions slot can hold real buttons beside it (nesting
         interactive elements inside a button is invalid and unreachable by keyboard). -->
    <div class="flex items-center transition hover:bg-pastel-sky/20">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
        :aria-expanded="open"
        @click="$emit('toggle')"
      >
        <ChevronDown class="h-4 w-4 shrink-0 text-ink-light transition" :class="open ? '' : '-rotate-90'" />
        <slot name="icon" />
        <span class="min-w-0 flex-1 truncate font-sans text-sm font-bold text-ink">{{ title }}</span>
        <!-- Shrinkable (not shrink-0) so a long summary ellipsizes instead of being clipped by the panel
             edge on a narrow screen; the full text stays in the tooltip. The ellipsis lives on an inner
             block because `pill` is an inline-flex container, where text-overflow does not apply. -->
        <span
          v-if="summary"
          class="pill min-w-0 max-w-[55%]"
          :class="summaryClass ?? 'bg-pastel-sky/60 text-ink-muted'"
          :title="summary"
        >
          <span class="min-w-0 truncate">{{ summary }}</span>
        </span>
      </button>
      <div class="shrink-0 pr-2">
        <slot name="actions" />
      </div>
    </div>

    <Transition name="list">
      <div v-show="open" class="border-t border-line p-4">
        <slot />
      </div>
    </Transition>
  </div>
</template>
