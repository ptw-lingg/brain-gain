<script setup lang="ts">
import AppSidebar from './AppSidebar.vue';
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-bg-primary">
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
</template>
