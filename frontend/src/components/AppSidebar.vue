<script setup lang="ts">
import { computed } from 'vue';
import {
  BookOpen,
  GraduationCap,
  ClipboardList,
  Briefcase,
  Building2,
  Users,
  UsersRound,
  SlidersHorizontal,
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const { t } = useI18n();

const isAdmin = computed(() => auth.user?.isAdmin ?? false);
const isTrainer = computed(() => auth.user?.isTrainer ?? false);
const isHead = computed(() => auth.user?.isHead ?? false);
</script>

<template>
  <aside class="flex w-60 shrink-0 flex-col bg-bg-sidebar px-3 py-5">
    <nav class="flex flex-1 flex-col gap-1">
      <RouterLink to="/dashboard" class="nav-item" active-class="nav-active">
        <BookOpen class="h-4 w-4" /> {{ t('nav.myTrainings') }}
      </RouterLink>

      <RouterLink v-if="isHead || isAdmin" to="/my-team" class="nav-item" active-class="nav-active">
        <UsersRound class="h-4 w-4" /> {{ t('nav.myTeam') }}
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
        <RouterLink to="/org-units" class="nav-item" active-class="nav-active">
          <Building2 class="h-4 w-4" /> {{ t('nav.orgUnits') }}
        </RouterLink>
        <RouterLink to="/users" class="nav-item" active-class="nav-active">
          <Users class="h-4 w-4" /> {{ t('nav.users') }}
        </RouterLink>
        <RouterLink to="/settings" class="nav-item" active-class="nav-active">
          <SlidersHorizontal class="h-4 w-4" /> {{ t('nav.settings') }}
        </RouterLink>
      </template>
    </nav>
  </aside>
</template>

<style scoped>
.nav-item {
  @apply flex items-center gap-3 rounded-md border-l-4 border-transparent px-3 py-2 text-sm font-medium text-petrol-100 transition hover:bg-white/10;
}
.nav-active {
  @apply border-orange-400 bg-petrol-600 font-semibold text-white;
}
</style>
