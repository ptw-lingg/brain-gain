<script setup lang="ts">
// A person's avatar: their profile picture when one is set, otherwise their initials. The initials
// circle takes its colour from the caller's class (bg-…), so each place keeps its own look. The
// name doubles as the alt text, so screen readers always hear who this is.
import { computed } from 'vue';

const props = withDefaults(defineProps<{ name: string; avatar?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg' }>(), {
  avatar: null,
  size: 'sm',
});

const SIZES = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-16 w-16 text-lg',
};

// "Tom Trainer" → "TT", "Muster, Anna" → "MA"; a single name keeps one letter.
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join(''),
);
</script>

<template>
  <img
    v-if="avatar"
    :src="avatar"
    :alt="name"
    class="shrink-0 rounded-full object-cover"
    :class="SIZES[size]"
    data-testid="user-avatar-image"
  />
  <span
    v-else
    class="flex shrink-0 select-none items-center justify-center rounded-full font-sans font-bold text-white"
    :class="SIZES[size]"
    role="img"
    :aria-label="name"
  >
    {{ initials }}
  </span>
</template>
