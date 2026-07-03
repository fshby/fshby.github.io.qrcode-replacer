<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import UploadPanel from '@/components/UploadPanel.vue'
import CanvasPreview from '@/components/CanvasPreview.vue'
import Toolbar from '@/components/Toolbar.vue'
import Toast from '@/components/Toast.vue'
import SupportModal from '@/components/SupportModal.vue'
import type { ImageUploadResult, QRCodeCorners } from '@/types'
import { useAppStore } from '@/stores/useAppStore'
import { useExport } from '@/composables/useExport'

const { state, clearError } = useAppStore()
const { download } = useExport()

const canvasPreview = ref<InstanceType<typeof CanvasPreview> | null>(null)
const toast = ref<InstanceType<typeof Toast> | null>(null)
const showSupportModal = ref(false)

const templateImage = computed(() => state.templateImage)
const qrImage = computed(() => state.qrImage)

const canExport = computed(() => {
  return state.templateImage !== null && 
         state.qrImage !== null && 
         state.selectionArea !== null &&
         !state.isDetecting && 
         !state.isCompositing
})

watch(() => state.error, (newError) => {
  if (newError) {
    toast.value?.error(newError)
    setTimeout(() => {
      clearError()
    }, 5000)
  }
})

function handleTemplateUploaded(_result: ImageUploadResult) {
  toast.value?.success('模板图上传成功，正在检测二维码...')
}

function handleQRUploaded(_result: ImageUploadResult) {
  toast.value?.success('二维码图上传成功，正在合成...')
}

function handleQRContentChanged(_content: string) {
  setTimeout(() => {
    canvasPreview.value?.performComposite()
  }, 300)
}

function handleCornersDetected(_corners: QRCodeCorners) {
  toast.value?.success('二维码检测成功，请调整锚点位置')
}

function handleCompositeComplete() {
  toast.value?.success('合成完成，可以导出图片了')
}

function handleReset() {
  canvasPreview.value?.clearCanvas()
  toast.value?.info('已重置画布')
}

function handleRedetect() {
  toast.value?.info('正在重新检测二维码...')
  canvasPreview.value?.reDetect()
}

async function handleExport() {
  const nativeCanvas = canvasPreview.value?.getCanvas()
  if (!nativeCanvas) return
  
  try {
    toast.value?.info('正在导出图片...')
    await download(nativeCanvas, {
      format: 'png',
      filename: 'qrcode-replaced'
    })
    toast.value?.success('图片导出成功')
    
    setTimeout(() => {
      showSupportModal.value = true
    }, 1000)
  } catch (err) {
    toast.value?.error(err instanceof Error ? err.message : '导出失败')
  }
}

function handleDebug() {
  canvasPreview.value?.showOffscreenCanvas()
}

function openSupportModal() {
  showSupportModal.value = true
}

function closeSupportModal() {
  showSupportModal.value = false
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
    <header class="bg-white/80 backdrop-blur-md shadow-sm border-b border-gray-100 sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div>
              <h1 class="text-lg font-bold text-gray-900">二维码替换工具</h1>
              <p class="text-xs text-gray-500">上传模板图和二维码，一键替换合成</p>
            </div>
          </div>
          
          <nav class="hidden md:flex items-center gap-4">
            <button
              class="text-sm text-red-500 hover:text-red-600 transition-colors flex items-center gap-1"
              @click="openSupportModal"
            >
              <span class="text-lg">❤️</span>
              请喝杯咖啡
            </button>
            <a href="#" class="text-sm text-gray-600 hover:text-blue-600 transition-colors">帮助</a>
            <a href="#" class="text-sm text-gray-600 hover:text-blue-600 transition-colors">关于</a>
          </nav>
        </div>
      </div>
    </header>
    
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div class="bg-white rounded-2xl shadow-lg shadow-gray-200/50 overflow-hidden">
        <div class="flex flex-col lg:flex-row h-[calc(100vh-14rem)]">
          <aside class="w-full lg:w-80 lg:border-r lg:border-gray-100 p-4 lg:p-6 overflow-y-auto">
            <UploadPanel
              @template-uploaded="handleTemplateUploaded"
              @qr-uploaded="handleQRUploaded"
              @qr-content-changed="handleQRContentChanged"
            />
            
            <div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <h3 class="text-sm font-medium text-blue-800 mb-2 flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                使用说明
              </h3>
              <ol class="text-xs text-blue-600 space-y-1.5">
                <li class="flex items-start gap-2">
                  <span class="w-5 h-5 flex-shrink-0 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center text-[10px] font-medium">1</span>
                  <span>上传模板图（海报、邀请函等）</span>
                </li>
                <li class="flex items-start gap-2">
                  <span class="w-5 h-5 flex-shrink-0 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center text-[10px] font-medium">2</span>
                  <span>系统自动检测并清空原有二维码区域</span>
                </li>
                <li class="flex items-start gap-2">
                  <span class="w-5 h-5 flex-shrink-0 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center text-[10px] font-medium">3</span>
                  <span>上传新二维码图，系统读取内容并生成标准二维码</span>
                </li>
                <li class="flex items-start gap-2">
                  <span class="w-5 h-5 flex-shrink-0 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center text-[10px] font-medium">4</span>
                  <span>自动合成到清空区域，可手动调整锚点位置</span>
                </li>
                <li class="flex items-start gap-2">
                  <span class="w-5 h-5 flex-shrink-0 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center text-[10px] font-medium">5</span>
                  <span>点击导出获取合成图片</span>
                </li>
              </ol>
            </div>
            
            <div class="mt-4 bg-gradient-to-r from-orange-50 to-pink-50 border border-orange-200 rounded-xl p-4">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span class="text-xl">☕</span>
                </div>
                <div class="flex-1">
                  <p class="text-xs font-medium text-orange-800">开发者正在吃土</p>
                  <p class="text-xs text-orange-600">如果这个工具帮到了你，求投喂！</p>
                </div>
                <button
                  class="px-3 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-medium rounded-lg hover:from-orange-600 hover:to-red-600 transition-all shadow-md shadow-orange-200"
                  @click="openSupportModal"
                >
                  支持一下
                </button>
              </div>
            </div>
          </aside>
          
          <div class="flex-1 p-4 lg:p-6 flex flex-col">
            <CanvasPreview
              ref="canvasPreview"
              :template-image="templateImage"
              :qr-image="qrImage"
              @corners-detected="handleCornersDetected"
              @composite-complete="handleCompositeComplete"
            />
          </div>
        </div>
        
        <Toolbar
          :can-export="canExport"
          @reset="handleReset"
          @redetect="handleRedetect"
          @export="handleExport"
          @debug="handleDebug"
        />
      </div>
    </main>
    
    <button
      class="fixed bottom-24 right-6 z-40 w-14 h-14 bg-gradient-to-br from-orange-500 via-red-500 to-pink-600 text-white rounded-full shadow-xl shadow-orange-300 flex items-center justify-center hover:scale-110 transition-transform"
      title="请开发者喝杯咖啡"
      @click="openSupportModal"
    >
      <span class="text-2xl">☕</span>
    </button>
    
    <Toast ref="toast" />
    <SupportModal :visible="showSupportModal" @close="closeSupportModal" />
  </div>
</template>
