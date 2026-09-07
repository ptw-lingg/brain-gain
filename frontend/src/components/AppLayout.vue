<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Eye, Info, Languages, LogOut, X } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth';
import { useLayoutStore } from '@/stores/layout';
import { SUPPORTED_LOCALES, type LocaleCode } from '@/i18n';
import AboutDialog from './AboutDialog.vue';
import AppSidebar from './AppSidebar.vue';
import BrainGainLogo from './BrainGainLogo.vue';
import LocaleFlag from './LocaleFlag.vue';

const auth = useAuthStore();
const layout = useLayoutStore();
const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();

// Leave the "view as" session: restore the admin's own token, then return to the Users page.
async function stopImpersonating(): Promise<void> {
  await auth.stopImpersonation();
  await router.push('/users');
}

// Section title shown in the teal page bar, derived from the active route.
const PAGE_TITLES: [prefix: string, key: string][] = [
  ['/dashboard', 'nav.myTrainings'],
  ['/session', 'nav.myTrainings'],
  ['/my-team', 'nav.myTeam'],
  ['/trainings', 'nav.trainings'],
  ['/trainees', 'nav.trainees'],
  ['/roles', 'nav.jobRoles'],
  ['/org-units', 'nav.orgUnits'],
  ['/users', 'nav.users'],
  ['/settings', 'nav.settings'],
  ['/backups', 'nav.backups'],
  ['/audit', 'nav.audit'],
];
const pageTitle = computed(() => {
  const hit = PAGE_TITLES.find(([prefix]) => route.path.startsWith(prefix));
  return hit ? t(hit[1]) : '';
});

const today = computed(() =>
  new Date().toLocaleDateString(locale.value, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }),
);

const initials = computed(() =>
  (auth.user?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase(),
);

const roleLabel = computed(() =>
  auth.user?.isAdmin
    ? t('nav.roleAdmin')
    : auth.user?.isTrainer
      ? t('nav.roleTrainer')
      : t('nav.roleMember'),
);

// User menu (avatar dropdown): language switch + about + logout.
const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);

// The About dialog is mounted OUTSIDE the dropdown so closing the menu does not unmount it.
const aboutOpen = ref(false);
function openAbout(): void {
  menuOpen.value = false;
  aboutOpen.value = true;
}

function onDocClick(e: MouseEvent): void {
  if (menuOpen.value && menuRoot.value && !menuRoot.value.contains(e.target as Node)) {
    menuOpen.value = false;
  }
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

function onLocaleChange(e: Event): void {
  auth.saveLocale((e.target as HTMLSelectElement).value as LocaleCode);
}

function logout(): void {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-bg-primary">
    <!-- Persistent banner while an admin is viewing the app as another user. -->
    <div
      v-if="auth.isImpersonating"
      class="flex shrink-0 items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-sm font-medium text-ink"
    >
      <Eye class="h-4 w-4" />
      <span>
        {{ t('impersonation.viewingAs') }} <strong>{{ auth.user?.name }}</strong>
        <span class="font-mono text-xs text-ink-muted">({{ auth.user?.email }})</span>
      </span>
      <button
        class="ml-2 inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1 text-xs font-semibold text-white transition hover:bg-ink/80"
        @click="stopImpersonating"
      >
        <X class="h-3.5 w-3.5" /> {{ t('impersonation.stop') }}
      </button>
    </div>

    <!-- Black app bar: logo left, app name centered, user menu right -->
    <header class="grid h-12 shrink-0 grid-cols-3 items-center bg-[#1a1a1a] px-4">
      <BrainGainLogo :size="26" on-dark />
      <div class="text-center text-sm font-bold uppercase tracking-[0.25em] text-white">
        BrainGain
      </div>
      <div ref="menuRoot" class="relative flex items-center justify-end">
        <button
          class="flex h-8 w-8 items-center justify-center rounded-full bg-petrol-500 text-xs font-bold text-white transition hover:bg-petrol-400"
          :title="auth.user?.name"
          :aria-label="t('nav.userMenu')"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          {{ initials }}
        </button>

        <Transition name="fade-slide">
          <div
            v-if="menuOpen"
            class="card absolute right-0 top-10 z-50 w-64 overflow-hidden p-0 text-left"
            role="menu"
          >
            <div class="border-b border-line px-4 py-3">
              <div class="truncate text-sm font-semibold text-ink">{{ auth.user?.name }}</div>
              <div class="truncate text-xs text-ink-muted">{{ auth.user?.email }}</div>
              <div class="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                {{ roleLabel }}
              </div>
            </div>

            <div class="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span class="flex items-center gap-2 text-sm text-ink-muted">
                <Languages class="h-4 w-4" /> {{ t('language.label') }}
              </span>
              <!-- A native dropdown (an <option> cannot render a flag, so the current language's
                   flag sits beside it). The choice switches the UI at once and is persisted to the
                   profile — except while impersonating, where it stays a local, temporary switch. -->
              <span class="flex items-center gap-2">
                <LocaleFlag :code="locale as string" />
                <select
                  :value="locale"
                  class="cursor-pointer rounded-md border border-line bg-white px-2 py-1 text-xs text-ink outline-none transition focus:border-accent"
                  :aria-label="t('language.label')"
                  @change="onLocaleChange"
                >
                  <option v-for="l in SUPPORTED_LOCALES" :key="l.code" :value="l.code">
                    {{ l.label }}
                  </option>
                </select>
              </span>
            </div>

            <button
              class="flex w-full items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:bg-petrol-50 hover:text-ink"
              role="menuitem"
              data-testid="about-open"
              @click="openAbout"
            >
              <Info class="h-4 w-4" /> {{ t('nav.about') }}
            </button>

            <button
              class="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:bg-petrol-50 hover:text-ink"
              role="menuitem"
              @click="logout"
            >
              <LogOut class="h-4 w-4" /> {{ t('nav.logout') }}
            </button>
          </div>
        </Transition>
      </div>
    </header>

    <!-- Teal page bar: section name (orange tab marker) left, date right -->
    <div class="flex h-9 shrink-0 items-center justify-between bg-petrol-800 px-4">
      <span
        class="flex h-full items-center border-b-2 border-orange-400 text-xs font-bold uppercase tracking-widest text-white"
      >
        {{ pageTitle }}
      </span>
      <span class="text-[11px] font-semibold text-petrol-200">{{ today }}</span>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <AppSidebar />
      <main class="flex-1" :class="layout.immersive ? 'overflow-hidden' : 'overflow-y-auto'">
        <!-- Data-dense pages (route meta fullWidth, e.g. the audit trail) use the whole window;
             everything else keeps the comfortable shared measure. A page showing EMBEDDED content
             (the material viewer, the SCORM player) claims the whole client area instead — full
             height, no padding, no page scroll (see stores/layout.ts). -->
        <div
          class="mx-auto"
          :class="
            layout.immersive
              ? 'h-full max-w-none'
              : route.meta.fullWidth
                ? 'max-w-none px-8 py-8'
                : 'max-w-6xl px-8 py-8'
          "
        >
          <!-- Deliberately NO <Transition> around the routed page: with mode="out-in" the enter of
               the next page is silently SKIPPED when navigating away from the param route
               (/session/:id) — the content area then stays blank on every navigation until a full
               reload — and without out-in the leaving and entering pages coexist, which breaks
               interaction during the overlap. A 150 ms fade is not worth either failure mode. -->
          <RouterView />
        </div>
      </main>
    </div>

    <AboutDialog v-if="aboutOpen" @close="aboutOpen = false" />
  </div>
</template>
