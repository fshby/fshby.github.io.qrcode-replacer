<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const activeTab = ref<'donate' | 'contact'>('donate')
const copied = ref(false)

function handleClose() {
  emit('close')
}

function copyWeChat() {
  navigator.clipboard.writeText('dev-wechat-id').then(() => {
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  })
}

watch(() => props.visible, (newVal) => {
  if (newVal) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @click.self="handleClose"
      >
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
        
        <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform">
          <button
            class="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
            @click="handleClose"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <div class="bg-gradient-to-br from-orange-400 via-red-500 to-pink-600 p-6 text-center">
            <div class="w-20 h-20 mx-auto mb-4 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
              <span class="text-4xl">☕</span>
            </div>
            <h2 class="text-2xl font-bold text-white mb-2">请开发者喝杯咖啡吧</h2>
            <p class="text-white/80 text-sm">您的支持是我继续开发的动力！</p>
          </div>
          
          <div class="p-6">
            <div class="flex bg-gray-100 rounded-xl p-1 mb-6">
              <button
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
                :class="[
                  activeTab === 'donate' 
                    ? 'bg-white text-orange-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-800'
                ]"
                @click="activeTab = 'donate'"
              >
                <span>💰</span>
                投喂开发者
              </button>
              <button
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
                :class="[
                  activeTab === 'contact' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-800'
                ]"
                @click="activeTab = 'contact'"
              >
                <span>💬</span>
                联系开发者
              </button>
            </div>
            
            <div v-if="activeTab === 'donate'" class="space-y-4">
              <div class="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
                <div class="flex items-center gap-3 mb-3">
                  <div class="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                    <span class="text-white font-bold text-lg">微</span>
                  </div>
                  <div>
                    <h4 class="font-medium text-gray-900">微信支付</h4>
                    <p class="text-xs text-gray-500">扫码即可投喂</p>
                  </div>
                </div>
                <div class="aspect-square bg-white rounded-lg p-2 border border-green-100">
                  <img 
                    src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=WeChat%20payment%20QR%20code%20simple%20clean%20design&image_size=square" 
                    alt="微信收款码" 
                    class="w-full h-full object-contain"
                  />
                </div>
              </div>
              
              <div class="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-200">
                <div class="flex items-center gap-3 mb-3">
                  <div class="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                    <span class="text-white font-bold text-lg">支</span>
                  </div>
                  <div>
                    <h4 class="font-medium text-gray-900">支付宝</h4>
                    <p class="text-xs text-gray-500">扫码即可投喂</p>
                  </div>
                </div>
                <div class="aspect-square bg-white rounded-lg p-2 border border-blue-100">
                  <img 
                    src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Alipay%20payment%20QR%20code%20simple%20clean%20design&image_size=square" 
                    alt="支付宝收款码" 
                    class="w-full h-full object-contain"
                  />
                </div>
              </div>
              
              <div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <div class="flex items-start gap-3">
                  <div class="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center flex-shrink-0">
                    <span class="text-sm">💡</span>
                  </div>
                  <div class="text-sm">
                    <p class="text-yellow-800 font-medium mb-1">温馨提示</p>
                    <p class="text-yellow-700">哪怕是 1 元钱，也能让开发者多吃一碗泡面！每一分钱都将用于购买咖啡和泡面，维持开发热情 😂</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div v-if="activeTab === 'contact'" class="space-y-4">
              <div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
                <div class="flex items-center gap-3 mb-3">
                  <div class="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                    <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.322-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.407-.032zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/>
                    </svg>
                  </div>
                  <div>
                    <h4 class="font-medium text-gray-900">微信联系</h4>
                    <p class="text-xs text-gray-500">扫码添加开发者微信</p>
                  </div>
                </div>
                <div class="aspect-square bg-white rounded-lg p-2 border border-blue-100">
                  <img 
                    src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=WeChat%20contact%20QR%20code%20simple%20clean%20design&image_size=square" 
                    alt="微信联系二维码" 
                    class="w-full h-full object-contain"
                  />
                </div>
              </div>
              
              <button
                v-if="!copied"
                class="w-full py-3 bg-blue-50 text-blue-600 rounded-xl font-medium hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                @click="copyWeChat"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                复制微信号
              </button>
              <div v-else class="w-full py-3 bg-green-50 text-green-600 rounded-xl font-medium flex items-center justify-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                已复制到剪贴板
              </div>
              
              <div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div class="flex items-start gap-3">
                  <div class="w-8 h-8 bg-blue-400 rounded-full flex items-center justify-center flex-shrink-0">
                    <span class="text-sm">💬</span>
                  </div>
                  <div class="text-sm">
                    <p class="text-blue-800 font-medium mb-1">关于反馈</p>
                    <p class="text-blue-700">有任何问题、建议或bug反馈，都可以添加微信联系我。你的每一条反馈都很重要！</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="px-6 pb-6">
            <button
              class="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium rounded-xl hover:from-orange-600 hover:to-red-600 transition-all shadow-lg shadow-orange-200"
              @click="handleClose"
            >
              谢谢支持，继续使用 ✨
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .relative,
.modal-leave-to .relative {
  transform: scale(0.9) translateY(20px);
}
</style>
