<script setup lang="ts">
// A language's flag (flag-icons CSS sprite), accessible as an image with the native language name.
// Sized by font-size — flag-icons is em-based — so it follows the surrounding text scale.
import { flagClass, localeName } from '@/utils/locales';

defineProps<{ code: string }>();
</script>

<template>
  <span
    :class="flagClass(code)"
    class="shrink-0 rounded-[2px] shadow-sm"
    role="img"
    :aria-label="localeName(code)"
    :title="localeName(code)"
  />
</template>
