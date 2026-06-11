<script setup lang="ts">
// The PTW corporate logo (red triangle + PTW wordmark + "The Dosimetry Company").
// `onDark` switches to the white-lettering variant for dark surfaces (e.g. the black app bar).
withDefaults(defineProps<{ size?: number; onDark?: boolean }>(), {
  size: 48,
  onDark: false,
});
</script>

<template>
  <img
    :src="onDark ? '/ptw-logo-white.svg' : '/ptw-logo.svg'"
    alt="BrainGain logo"
    aria-label="BrainGain logo"
    class="block w-auto"
    :style="{ height: `${size}px` }"
  />
</template>
