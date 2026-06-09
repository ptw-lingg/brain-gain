<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  BookOpen,
  GraduationCap,
  ClipboardList,
  Briefcase,
  Users,
  SlidersHorizontal,
  ListChecks,
  LogOut,
  Languages,
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { SUPPORTED_LOCALES, setLocale, type LocaleCode } from '@/i18n';
import BrainGainLogo from './BrainGainLogo.vue';

const auth = useAuthStore();
const router = useRouter();
const { t, locale } = useI18n();

function onLocaleChange(e: Event): void {
  setLocale((e.target as HTMLSelectElement).value as LocaleCode);
}

const isAdmin = computed(() => auth.user?.isAdmin ?? false);
const isTrainer = computed(() => auth.user?.isTrainer ?? false);
// Requirements/DMS tooling is internal-only (dev + internal build), excluded from the public build.
const internalTools = import.meta.env.DEV || import.meta.env.VITE_INTERNAL === 'true';

const initials = computed(() =>
  (auth.user?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase(),
);

function logout(): void {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <aside
    class="flex w-60 shrink-0 flex-col border-r border-line bg-bg-sidebar px-4 py-6"
  >
    <div class="px-2">
      <BrainGainLogo :size="40" show-wordmark />
    </div>

    <nav class="mt-8 flex flex-1 flex-col gap-1">
      <RouterLink to="/dashboard" class="nav-item" active-class="nav-active">
        <BookOpen class="h-4 w-4" /> {{ t('nav.myTrainings') }}
      </RouterLink>

      <template v-if="isAdmin || isTrainer">
        <RouterLink to="/trainings" class="nav-item" active-class="nav-active">
          <GraduationCap class="h-4 w-4" /> {{ t('nav.trainings') }}
        </RouterLink>
        <RouterLink to="/trainees" class="nav-item" active-class="nav-active">
          <ClipboardList class="h-4 w-4" /> {{ t('nav.trainees') }}
        </RouterLink>
      </template>

      <template v-if="isAdmin">
        <RouterLink to="/roles" class="nav-item" active-class="nav-active">
          <Briefcase class="h-4 w-4" /> {{ t('nav.jobRoles') }}
        </RouterLink>
        <RouterLink to="/users" class="nav-item" active-class="nav-active">
          <Users class="h-4 w-4" /> {{ t('nav.users') }}
        </RouterLink>
        <RouterLink to="/settings" class="nav-item" active-class="nav-active">
          <SlidersHorizontal class="h-4 w-4" /> {{ t('nav.settings') }}
        </RouterLink>
        <RouterLink v-if="internalTools" to="/requirements" class="nav-item" active-class="nav-active">
          <ListChecks class="h-4 w-4" /> {{ t('nav.requirements') }}
        </RouterLink>
      </template>
    </nav>

    <!-- Language switcher -->
    <label class="mb-3 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-wider text-ink-light">
      <Languages class="h-3.5 w-3.5" />
      <span class="sr-only">{{ t('language.label') }}</span>
      <select
        :value="locale"
        class="flex-1 rounded-md border border-line bg-white/70 px-2 py-1 text-xs font-medium normal-case tracking-normal text-ink-muted"
        :aria-label="t('language.label')"
        @change="onLocaleChange"
      >
        <option v-for="l in SUPPORTED_LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
      </select>
    </label>

    <div class="mt-4 flex items-center gap-3 rounded-lg border border-line bg-white/70 px-3 py-2.5">
      <div
        class="flex h-9 w-9 items-center justify-center rounded-full bg-accent font-sans text-xs font-bold text-white"
      >
        {{ initials }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold text-ink">{{ auth.user?.name }}</div>
        <div class="truncate font-mono text-[10px] text-ink-light">
          {{ isAdmin ? t('nav.roleAdmin') : isTrainer ? t('nav.roleTrainer') : t('nav.roleMember') }}
        </div>
      </div>
      <button class="text-ink-light hover:text-accent" :title="t('nav.logout')" @click="logout">
        <LogOut class="h-4 w-4" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
.nav-item {
  @apply flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-white/60;
}
.nav-active {
  @apply bg-white font-semibold text-accent shadow-soft;
}
</style>
