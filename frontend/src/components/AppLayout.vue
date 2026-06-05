<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Eye, X } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth';
import AppSidebar from './AppSidebar.vue';

const auth = useAuthStore();
const router = useRouter();

// Leave the "view as" session: restore the admin's own token, then return to the Users page.
async function stopImpersonating(): Promise<void> {
  await auth.stopImpersonation();
  await router.push('/users');
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
        Viewing as <strong>{{ auth.user?.name }}</strong>
        <span class="font-mono text-xs text-ink-muted">({{ auth.user?.email }})</span>
      </span>
      <button
        class="ml-2 inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1 text-xs font-semibold text-white transition hover:bg-ink/80"
        @click="stopImpersonating"
      >
        <X class="h-3.5 w-3.5" /> Stop
      </button>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <AppSidebar />
      <main class="flex-1 overflow-y-auto">
        <div class="mx-auto max-w-6xl px-8 py-8">
          <RouterView v-slot="{ Component }">
            <Transition name="fade-slide" mode="out-in">
              <component :is="Component" />
            </Transition>
          </RouterView>
        </div>
      </main>
    </div>
  </div>
</template>
