<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { ImageUploadResult } from '@/types'
import { useImageUpload } from '@/composables/useImageUpload'
import { useAppStore } from '@/stores/useAppStore'

const emit = defineEmits<{
  (e: 'template-selected', result: ImageUploadResult): void
}>()

const { upload } = useImageUpload()
const { setTemplateImage, setError } = useAppStore()

interface TemplateItem {
  id: string
  name: string
  description: string
  category: string
  imageUrl: string
  thumbnailUrl: string
  width: number
  height: number
}

const activeTab = ref<'preset' | 'custom'>('preset')
const templates = ref<TemplateItem[]>([])
const loadingTemplates = ref(true)
const selectedTemplate = ref<string | null>(null)

const customPreview = ref<string | null>(null)
const customPlaceholder = ref(true)

async function loadTemplates() {
  loadingTemplates.value = true
  try {
    const response = await fetch('/templates/templates.json')
    const data = await response.json()
    templates.value = data.templates || []
  } catch (err) {
    console.error('加载模板列表失败:', err)
    templates.value = []
  } finally {
    loadingTemplates.value = false
  }
}

async function selectTemplate(template: TemplateItem) {
  selectedTemplate.value = template.id
  
  const img = await loadImage(template.imageUrl)
  
  const result: ImageUploadResult = {
    id: template.id,
    file: new File([], `${template.id}.webp`, { type: 'image/webp' }),
    url: template.imageUrl,
    width: img.width,
    height: img.height,
    type: 'template'
  }
  
  setTemplateImage(result)
  emit('template-selected', result)
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

async function handleCustomUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return
  
  try {
    const result = await upload(files[0], 'template')
    result.type = 'template'
    customPreview.value = result.url
    customPlaceholder.value = false
    setTemplateImage(result)
    emit('template-selected', result)
  } catch (err) {
    setError(err instanceof Error ? err.message : '上传失败')
  }
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
  
  const input = document.getElementById('custom-template-input') as HTMLInputElement
  input.files = files
  handleCustomUpload({ target: input } as unknown as Event)
}

onMounted(() => {
  loadTemplates()
})
</script>

<template>
  <div class="space-y-4">
    <div class="text-sm font-medium text-gray-700 mb-4">选择模板</div>
    
    <div class="flex bg-gray-100 rounded-xl p-1">
      <button
        type="button"
        class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200"
        :class="[
          activeTab === 'preset' 
            ? 'bg-white text-blue-600 shadow-sm' 
            : 'text-gray-600 hover:text-gray-800'
        ]"
        @click="activeTab = 'preset'"
      >
        <svg class="w-4 h-4 inline-block mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
        预制模板
      </button>
      <button
        type="button"
        class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200"
        :class="[
          activeTab === 'custom' 
            ? 'bg-white text-blue-600 shadow-sm' 
            : 'text-gray-600 hover:text-gray-800'
        ]"
        @click="activeTab = 'custom'"
      >
        <svg class="w-4 h-4 inline-block mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        自定义上传
      </button>
    </div>
    
    <div v-if="activeTab === 'preset'" class="space-y-4">
      <div v-if="loadingTemplates" class="flex items-center justify-center py-8">
        <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
      
      <div v-else-if="templates.length === 0" class="text-center py-8 text-gray-400">
        <svg class="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p class="text-sm">暂无预制模板</p>
      </div>
      
      <div v-else class="grid grid-cols-2 gap-3">
        <button
          v-for="template in templates"
          :key="template.id"
          type="button"
          class="relative group rounded-xl overflow-hidden border-2 transition-all duration-200"
          :class="[
            selectedTemplate === template.id
              ? 'border-blue-500 shadow-lg shadow-blue-100'
              : 'border-gray-200 hover:border-blue-300 hover:shadow-md'
          ]"
          @click="selectTemplate(template)"
        >
          <div class="aspect-[4/3] bg-gray-100 overflow-hidden">
            <img
              :src="template.thumbnailUrl || template.imageUrl"
              :alt="template.name"
              class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          </div>
          <div class="p-3 bg-white">
            <h4 class="text-sm font-medium text-gray-800 truncate">{{ template.name }}</h4>
            <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">{{ template.description }}</p>
          </div>
          <div
            v-if="selectedTemplate === template.id"
            class="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center"
          >
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </button>
      </div>
      
      <p class="text-xs text-gray-400 text-center">点击模板即可使用，也可上传自定义模板</p>
    </div>
    
    <div v-if="activeTab === 'custom'" class="space-y-4">
      <div
        class="relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-300"
        :class="[
          customPlaceholder 
            ? 'border-gray-300 hover:border-blue-500 hover:bg-blue-50' 
            : 'border-blue-500 bg-blue-50'
        ]"
        @dragover="handleDragOver"
        @drop="handleDrop"
        @click="() => ($refs.customInput as HTMLInputElement)?.click()"
      >
        <input
          ref="customInput"
          id="custom-template-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          class="hidden"
          @change="handleCustomUpload"
        />
        
        <div v-if="customPlaceholder" class="space-y-3">
          <div class="w-16 h-16 mx-auto rounded-full bg-gray-100 flex items-center justify-center">
            <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div class="space-y-1">
            <p class="text-sm font-medium text-gray-600">点击或拖拽上传自定义模板图</p>
            <p class="text-xs text-gray-400">支持 PNG、JPG、WEBP 格式</p>
          </div>
        </div>
        
        <div v-else class="space-y-3">
          <img :src="customPreview || ''" class="max-h-32 mx-auto rounded-lg object-contain" alt="自定义模板预览" />
          <p class="text-xs text-blue-600">已上传自定义模板</p>
        </div>
      </div>
    </div>
  </div>
</template>
