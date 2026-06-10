<script setup lang="ts">
// Reusable toolbar placed above any list: a text search box (filters entries by visible text) and an
// optional expand-all / collapse-all button. The owning page keeps the query (v-model:query) and does
// its own filtering. The button is only rendered when the list's entries are individually expandable
// (`expandable`); it toggles every entry at once and the page owns the actual open/closed state.
import { useI18n } from 'vue-i18n';
import { Search, ChevronsDownUp, ChevronsUpDown } from 'lucide-vue-next';

defineProps<{
  query: string;
  count: number; // entries currently shown (after filtering)
  total: number; // entries before filtering
  placeholder?: string;
  expandable?: boolean; // render the expand-all/collapse-all button
  allExpanded?: boolean; // current state — drives the button's icon/label
}>();
const emit = defineEmits<{
  'update:query': [value: string];
  'toggle-all': [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="mb-3 flex items-center gap-2">
    <div class="relative min-w-[180px] flex-1">
      <Search class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-light" />
      <input
        :value="query"
        type="search"
        class="bg-input w-full !pl-9"
        :placeholder="placeholder ?? t('common.search')"
        :aria-label="placeholder ?? t('common.search')"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <span class="shrink-0 font-mono text-xs text-ink-light">{{ query.trim() ? `${count}/${total}` : total }}</span>
    <button
      v-if="expandable"
      type="button"
      class="btn-ghost shrink-0"
      :aria-label="allExpanded ? t('common.collapseAll') : t('common.expandAll')"
      :title="allExpanded ? t('common.collapseAll') : t('common.expandAll')"
      @click="emit('toggle-all')"
    >
      <ChevronsDownUp v-if="allExpanded" class="h-4 w-4" />
      <ChevronsUpDown v-else class="h-4 w-4" />
    </button>
  </div>
</template>
