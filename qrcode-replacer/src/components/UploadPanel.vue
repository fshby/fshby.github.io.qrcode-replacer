<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ImageUploadResult } from '@/types'
import { useImageUpload } from '@/composables/useImageUpload'
import { useQRDetect } from '@/composables/useQRDetect'
import { useAppStore } from '@/stores/useAppStore'
import TemplateSelector from './TemplateSelector.vue'

const emit = defineEmits<{
  (e: 'template-uploaded', result: ImageUploadResult): void
  (e: 'qr-uploaded', result: ImageUploadResult): void
  (e: 'qr-content-changed', content: string): void
}>()

const { upload, isUploading } = useImageUpload()
const { setQRImage, setQRContent, setError, state } = useAppStore()
const { detect } = useQRDetect()

const qrPreview = ref<string | null>(null)
const qrPlaceholder = ref(true)

const qrContent = ref('')
const isEditing = ref(false)
const editValue = ref('')
const isRefreshing = ref(false)

async function handleQRUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return
  
  try {
    const result = await upload(files[0], 'qr')
    result.type = 'qr'
    qrPreview.value = result.url
    qrPlaceholder.value = false
    setQRImage(result)
    emit('qr-uploaded', result)
    
    const img = await loadImage(result.url)
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = img.width
    tempCanvas.height = img.height
    const tempCtx = tempCanvas.getContext('2d')!
    tempCtx.drawImage(img, 0, 0)
    
    const detectResult = await detect(tempCanvas)
    if (detectResult.success && detectResult.data) {
      qrContent.value = detectResult.data
      editValue.value = detectResult.data
      setQRContent(detectResult.data)
      emit('qr-content-changed', detectResult.data)
    } else {
      qrContent.value = ''
      editValue.value = ''
      setQRContent('')
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : '上传失败')
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return
  
  const file = files[0]
  if (!file.type.startsWith('image/')) return
  
  if (qrPlaceholder.value) {
    const input = document.getElementById('qr-input') as HTMLInputElement
    input.files = files
    handleQRUpload({ target: input } as unknown as Event)
  }
}

function startEdit() {
  editValue.value = qrContent.value
  isEditing.value = true
}

function saveEdit() {
  if (editValue.value.trim() !== qrContent.value) {
    qrContent.value = editValue.value.trim()
    setQRContent(qrContent.value)
    emit('qr-content-changed', qrContent.value)
  }
  isEditing.value = false
}

function cancelEdit() {
  isEditing.value = false
}

async function refreshQR() {
  if (!qrContent.value.trim()) return
  
  isRefreshing.value = true
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    
    await import('qrcode').then(({ default: QRCode }) => {
      return QRCode.toCanvas(canvas, qrContent.value, {
        width: 512,
        margin: 0,
        color: { dark: '#000000', light: '#ffffff' }
      })
    })
    
    const dataUrl = canvas.toDataURL('image/png')
    qrPreview.value = dataUrl
    
    const result: ImageUploadResult = {
      id: `${Date.now()}-generated`,
      file: new File([], 'generated-qr.png', { type: 'image/png' }),
      url: dataUrl,
      width: 512,
      height: 512,
      type: 'qr'
    }
    
    setQRImage(result)
    emit('qr-uploaded', result)
  } catch (err) {
    setError(err instanceof Error ? err.message : '生成二维码失败')
  } finally {
    isRefreshing.value = false
  }
}

function copyQRContent() {
  if (!qrContent.value) return
  
  navigator.clipboard.writeText(qrContent.value).then(() => {
    const btn = document.getElementById('copy-btn')
    if (btn) {
      const originalText = btn.innerHTML
      btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>'
      setTimeout(() => {
        btn.innerHTML = originalText
      }, 2000)
    }
  })
}

watch(() => state.qrContent, (newContent) => {
  if (newContent !== qrContent.value) {
    qrContent.value = newContent
    editValue.value = newContent
  }
})
</script>

<template>
  <div class="space-y-6">
    <TemplateSelector @template-selected="(result) => emit('template-uploaded', result)" />
    
    <div class="text-sm font-medium text-gray-700 mb-4">上传二维码</div>
    
    <div
      class="relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-300"
      :class="[
        qrPlaceholder 
          ? 'border-gray-300 hover:border-green-500 hover:bg-green-50' 
          : 'border-green-500 bg-green-50'
      ]"
      @dragover="handleDragOver"
      @drop="handleDrop"
      @click="() => ($refs.qrInput as HTMLInputElement)?.click()"
    >
      <input
        ref="qrInput"
        id="qr-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        class="hidden"
        @change="handleQRUpload"
      />
      
      <div v-if="qrPlaceholder" class="space-y-3">
        <div class="w-16 h-16 mx-auto rounded-full bg-gray-100 flex items-center justify-center">
          <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
        </div>
        <div class="space-y-1">
          <p class="text-sm font-medium text-gray-600">点击或拖拽上传二维码图</p>
          <p class="text-xs text-gray-400">建议分辨率 ≥ 200×200px</p>
        </div>
      </div>
      
      <div v-else class="space-y-3">
        <img :src="qrPreview || ''" class="max-h-32 mx-auto rounded-lg object-contain" alt="二维码预览" />
        <p class="text-xs text-green-600">已上传二维码图</p>
      </div>
      
      <div v-if="isUploading" class="absolute inset-0 bg-white/80 flex items-center justify-center rounded-xl">
        <div class="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    </div>
    
    <div v-if="qrContent" class="bg-gray-50 rounded-xl p-4 border border-gray-200">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          <span class="text-sm font-medium text-gray-700">二维码内容</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            id="copy-btn"
            type="button"
            class="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="复制链接"
            @click="copyQRContent"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button
            type="button"
            class="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
            title="重新生成二维码"
            @click="refreshQR"
            :disabled="isRefreshing"
          >
            <svg v-if="!isRefreshing" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <svg v-else class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            v-if="!isEditing"
            type="button"
            class="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            @click="startEdit"
          >
            编辑
          </button>
          <button
            v-else
            type="button"
            class="px-3 py-1 text-xs font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
            @click="saveEdit"
          >
            保存
          </button>
          <button
            v-if="isEditing"
            type="button"
            class="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            @click="cancelEdit"
          >
            取消
          </button>
        </div>
      </div>
      
      <div v-if="!isEditing" class="break-all text-sm text-gray-600 bg-white rounded-lg p-3 border border-gray-200">
        {{ qrContent }}
      </div>
      <div v-else class="space-y-3">
        <textarea
          v-model="editValue"
          class="w-full text-sm text-gray-800 bg-white rounded-lg p-3 border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none resize-none"
          rows="3"
          placeholder="输入二维码内容..."
        ></textarea>
        <p class="text-xs text-gray-400">修改后点击保存，系统将自动重新生成二维码并合成到模板</p>
      </div>
    </div>
  </div>
</template>
