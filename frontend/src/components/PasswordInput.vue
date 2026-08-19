<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue';
import { useI18n } from 'vue-i18n';
import { Eye, EyeOff } from 'lucide-vue-next';

// A bg-input password field with a show/hide toggle. Class and style land on the wrapper (so
// layout classes like mt-2 move the whole field and keep the toggle aligned); everything else —
// placeholder, autocomplete, required, data-testid, listeners — falls through to the input.
defineOptions({ inheritAttrs: false });

const model = defineModel<string>({ default: '' });
const { t } = useI18n();

const attrs = useAttrs();
const wrapperClass = computed(() => attrs.class as string | undefined);
const wrapperStyle = computed(() => attrs.style as string | undefined);
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});

const show = ref(false);
</script>

<template>
  <div class="relative" :class="wrapperClass" :style="wrapperStyle">
    <input v-model="model" :type="show ? 'text' : 'password'" class="bg-input pr-10" v-bind="inputAttrs" />
    <!-- tabindex -1: tabbing goes from the password straight to the next field; the toggle is a
         mouse/touch affordance, not a form stop. -->
    <button
      type="button"
      tabindex="-1"
      class="absolute inset-y-0 right-0 flex items-center px-3 text-ink-light transition hover:text-ink"
      :title="show ? t('common.hidePassword') : t('common.showPassword')"
      :aria-label="show ? t('common.hidePassword') : t('common.showPassword')"
      @click="show = !show"
    >
      <EyeOff v-if="show" class="h-4 w-4" />
      <Eye v-else class="h-4 w-4" />
    </button>
  </div>
</template>
