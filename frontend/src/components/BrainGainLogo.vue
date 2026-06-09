<script setup lang="ts">
import { useI18n } from 'vue-i18n';

withDefaults(defineProps<{ size?: number; showWordmark?: boolean }>(), {
  size: 48,
  showWordmark: false,
});

const { t } = useI18n();
</script>

<template>
  <div class="flex items-center gap-3">
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="BrainGain logo"
      role="img"
    >
      <defs>
        <linearGradient :id="`bgGrad-${size}`" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#D0EEFF" />
          <stop offset="1" stop-color="#2B78E4" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" :fill="`url(#bgGrad-${size})`" />
      <path
        d="M24 20c-4 0-7 3-7 7 0 1.5.5 3 1.5 4-1 1-1.5 2.5-1.5 4 0 4 3 7 7 7h3V20h-3z"
        fill="none"
        stroke="#fff"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      <path
        d="M31 18h2c5 0 9 4 9 9 0 2-.7 3.8-1.8 5.2"
        fill="none"
        stroke="#fff"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <polyline
        points="34,42 40,34 45,38 52,28"
        fill="none"
        stroke="#fff"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        points="47,28 52,28 52,33"
        fill="none"
        stroke="#fff"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <div v-if="showWordmark" class="leading-tight">
      <div class="bg-gradient-to-r from-accent to-sky-400 bg-clip-text text-xl font-bold text-transparent">
        BrainGain
      </div>
      <div class="font-mono text-[10px] text-ink-light">{{ t('common.tagline') }}</div>
    </div>
  </div>
</template>
