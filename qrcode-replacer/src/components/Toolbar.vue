<script setup lang="ts">
import { useAppStore } from '@/stores/useAppStore'
import { useExport } from '@/composables/useExport'

const props = defineProps<{
  canExport: boolean
}>()

const emit = defineEmits<{
  (e: 'reset'): void
  (e: 'undo'): void
  (e: 'redetect'): void
  (e: 'export'): void
  (e: 'debug'): void
}>()

const { state, undo, reset } = useAppStore()
const { isExporting } = useExport()

function handleReset() {
  reset()
  emit('reset')
}

function handleUndo() {
  undo()
  emit('undo')
}

function handleRedetect() {
  emit('redetect')
}

function handleExport() {
  emit('export')
}

function handleDebug() {
  emit('debug')
}
</script>

<template>
  <div class="flex items-center justify-between px-6 py-4 bg-white border-t border-gray-200 rounded-b-xl">
    <div class="flex items-center gap-2">
      <button
        @click="handleReset"
        :disabled="!state.templateImage"
        class="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
      >
        <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        重置
      </button>
      
      <button
        @click="handleUndo"
        :disabled="state.history.length === 0"
        class="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
      >
        <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
        撤销
      </button>
      
      <button
        @click="handleRedetect"
        :disabled="!state.templateImage || state.isDetecting"
        class="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
      >
        <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        重新检测
      </button>
    </div>
    
    <div class="flex items-center gap-3">
      <div v-if="state.isDetecting" class="flex items-center gap-2 text-sm text-blue-600">
        <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        检测中...
      </div>
      
      <div v-else-if="state.isCompositing" class="flex items-center gap-2 text-sm text-green-600">
        <div class="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
        合成中...
      </div>
      
      <button
        @click="handleExport"
        :disabled="!props.canExport || isExporting"
        class="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-lg shadow-blue-200"
      >
        <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        {{ isExporting ? '导出中...' : '导出 PNG' }}
      </button>
      
      <button
        @click="handleDebug"
        :disabled="!state.templateImage"
        class="px-4 py-2 text-sm font-medium text-gray-600 bg-yellow-100 hover:bg-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        title="查看离屏Canvas内容"
      >
        <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        调试
      </button>
    </div>
  </div>
</template>
