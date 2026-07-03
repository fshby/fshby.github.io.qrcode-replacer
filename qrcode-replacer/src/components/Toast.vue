<script setup lang="ts">
import { ref } from 'vue'

interface ToastMessage {
  id: number
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

const messages = ref<ToastMessage[]>([])
let messageId = 0

function showToast(type: ToastMessage['type'], message: string, duration: number = 3000) {
  const id = ++messageId
  messages.value.push({ id, type, message, duration })
  
  if (duration > 0) {
    setTimeout(() => {
      removeToast(id)
    }, duration)
  }
}

function removeToast(id: number) {
  const index = messages.value.findIndex(m => m.id === id)
  if (index !== -1) {
    messages.value.splice(index, 1)
  }
}

function getIcon(type: ToastMessage['type']) {
  switch (type) {
    case 'success':
      return 'M5 13l4 4L19 7'
    case 'error':
      return 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
    case 'warning':
      return 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
    case 'info':
      return 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
    default:
      return ''
  }
}

function getStyles(type: ToastMessage['type']) {
  switch (type) {
    case 'success':
      return 'bg-green-500 text-white shadow-lg shadow-green-200'
    case 'error':
      return 'bg-red-500 text-white shadow-lg shadow-red-200'
    case 'warning':
      return 'bg-yellow-500 text-white shadow-lg shadow-yellow-200'
    case 'info':
      return 'bg-blue-500 text-white shadow-lg shadow-blue-200'
    default:
      return 'bg-gray-500 text-white'
  }
}

defineExpose({
  show: showToast,
  success: (msg: string) => showToast('success', msg),
  error: (msg: string) => showToast('error', msg),
  warning: (msg: string) => showToast('warning', msg),
  info: (msg: string) => showToast('info', msg)
})
</script>

<template>
  <div class="fixed top-20 right-6 z-50 flex flex-col gap-3">
    <TransitionGroup name="toast">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg backdrop-blur-sm min-w-[280px] max-w-[400px]"
        :class="getStyles(msg.type)"
        @click="removeToast(msg.id)"
      >
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIcon(msg.type)" />
        </svg>
        <p class="text-sm font-medium flex-1">{{ msg.message }}</p>
        <button class="text-white/70 hover:text-white transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active {
  transition: all 0.3s ease-out;
}

.toast-leave-active {
  transition: all 0.3s ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-move {
  transition: transform 0.3s ease;
}
</style>
