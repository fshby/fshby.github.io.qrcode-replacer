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
  navigator.clipboard.writeText('zkffshby').then(() => {
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
        class="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4"
        @click.self="handleClose"
      >
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>

        <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
          <button
            class="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
            @click="handleClose"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div class="px-6 pt-6 pb-4 text-center flex-shrink-0">
            <h2 class="text-xl font-semibold text-gray-900">支持作者</h2>
            <p class="text-sm text-gray-500 mt-1">如果你觉得这个工具好用，可以请作者喝杯咖啡 ☕</p>
          </div>

          <div class="px-6 overflow-y-auto flex-1">
            <div class="flex bg-gray-100 rounded-xl p-1 mb-4">
              <button
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200"
                :class="[
                  activeTab === 'donate'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                ]"
                @click="activeTab = 'donate'"
              >
                打赏
              </button>
              <button
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200"
                :class="[
                  activeTab === 'contact'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                ]"
                @click="activeTab = 'contact'"
              >
                反馈
              </button>
            </div>

            <div v-if="activeTab === 'donate'" class="space-y-3 pb-2">
              <div class="bg-green-50 rounded-xl p-3 border border-green-100">
                <div class="flex items-center gap-3 mb-3">
                  <div class="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                    <span class="text-white font-bold text-sm">微</span>
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-gray-900">微信</h4>
                    <p class="text-xs text-gray-500">扫码打赏</p>
                  </div>
                </div>
                <div class="aspect-square max-w-[220px] mx-auto bg-white rounded-lg p-2 border border-green-100">
                  <img

                   
                    src="../../public/donate/wechat-pay.webp"
                    alt="微信收款码"
                    class="w-full h-full object-contain"
                  />
                </div>
              </div>

              <div class="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <div class="flex items-center gap-3 mb-3">
                  <div class="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                    <span class="text-white font-bold text-sm">支</span>
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-gray-900">支付宝</h4>
                    <p class="text-xs text-gray-500">扫码打赏</p>
                  </div>
                </div>
                <div class="aspect-square max-w-[220px] mx-auto bg-white rounded-lg p-2 border border-blue-100">
                  <img
                    src="../../public/donate/alipay.webp"
                    alt="支付宝收款码"
                    class="w-full h-full object-contain"
                  />
                </div>
              </div>
            </div>

            <div v-if="activeTab === 'contact'" class="space-y-3 pb-2">
              <div class="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <div class="flex items-center gap-3 mb-3">
                  <div class="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                    <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.322-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.407-.032zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/>
                    </svg>
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-gray-900">微信联系</h4>
                    <p class="text-xs text-gray-500">扫码或复制微信号</p>
                  </div>
                </div>
                <div class="aspect-square max-w-[220px] mx-auto bg-white rounded-lg p-2 border border-blue-100">
                  <img
                    src="../../public/donate/contact-qr.webp"
                    alt="微信联系二维码"
                    class="w-full h-full object-contain"
                  />
                </div>
              </div>

              <button
                v-if="!copied"
                class="w-full py-2.5 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                @click="copyWeChat"
              >
                复制微信号
              </button>
              <div v-else class="w-full py-2.5 bg-green-50 text-green-700 rounded-xl font-medium text-center">
                已复制到剪贴板
              </div>

              <p class="text-xs text-gray-500 text-center">
                有任何问题或建议，欢迎反馈。
              </p>
            </div>
          </div>

          <div class="px-6 pt-3 pb-5 flex-shrink-0 border-t border-gray-100">
            <button
              class="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors"
              @click="handleClose"
            >
              关闭
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
