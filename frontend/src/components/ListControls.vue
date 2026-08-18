<script setup lang="ts">
// Reusable toolbar placed above any list: a text search box that filters entries by visible text,
// with a shown/total count. The owning page keeps the query (v-model:query) and does its own
// filtering. Expandable lists behave as an accordion owned by the page (one entry open at a time,
// collapsed on entry) — there is no expand-all/collapse-all control.
import { useI18n } from 'vue-i18n';
import { Search } from 'lucide-vue-next';

defineProps<{
  query: string;
  count: number; // entries currently shown (after filtering)
  total: number; // entries before filtering
  placeholder?: string;
}>();
const emit = defineEmits<{
  'update:query': [value: string];
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
  </div>
</template>
