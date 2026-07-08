<template>
  <div id="app">
    <router-view />
    <!-- ARIA live regions for screen-reader announcements (no Web Speech TTS) -->
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ politeMessage }}</div>
    <div class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{{ assertiveMessage }}</div>
    <!-- Toast notifications -->
    <div class="toast-container" v-if="toastStore.toasts.length > 0">
      <div 
        v-for="toast in toastStore.toasts" 
        :key="toast.id"
        class="toast"
        :class="toast.type"
      >
        {{ toast.message }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToastStore } from '@/stores/toast'
import { useAnnouncer } from '@/composables/useAnnouncer'

const toastStore = useToastStore()
const { politeMessage, assertiveMessage } = useAnnouncer()

// Authentication is now handled by the router guard in main.ts
</script>

<style>
#app {
  height: var(--vh-dynamic, 100vh);
  width: 100vw;
  overflow: hidden;
}

.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toast {
  padding: 12px 16px;
  border-radius: 8px;
  color: white;
  font-size: 14px;
  max-width: 300px;
  animation: slideIn 0.3s ease-out;
}

.toast.success {
  background-color: #10b981;
}

.toast.error {
  background-color: #ef4444;
}

.toast.info {
  background-color: #3b82f6;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
</style>