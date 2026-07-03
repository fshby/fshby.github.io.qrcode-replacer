<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { fabric } from 'fabric'
import type { ImageUploadResult, QRCodeCorners, Point } from '@/types'
import { useQRDetect } from '@/composables/useQRDetect'
import { usePerspectiveTransform } from '@/composables/usePerspectiveTransform'
import { useAppStore } from '@/stores/useAppStore'
import { loadImage } from '@/utils/imageUtils'
import { clearQrRegion } from '@/utils/perspectiveUtils'
import { generateQRCode } from '@/utils/qrGenerator'

const props = defineProps<{
  templateImage: ImageUploadResult | null
  qrImage: ImageUploadResult | null
}>()

const emit = defineEmits<{
  (e: 'corners-detected', corners: QRCodeCorners): void
  (e: 'composite-complete'): void
}>()

const canvasContainer = ref<HTMLDivElement | null>(null)
const canvas = ref<fabric.Canvas | null>(null)
const scale = ref(1)
const { detect } = useQRDetect()
const { transform } = usePerspectiveTransform()
const { setQRCorners, setSelectionArea, setIsDetecting, setIsCompositing, setError, state } = useAppStore()

let templateFabricImage: fabric.Image | null = null
let anchorPoints: fabric.Circle[] = []
let offscreenCanvas: HTMLCanvasElement | null = null
let templateScale = 1
let templateOffsetX = 0
let templateOffsetY = 0

onMounted(() => {
  if (canvasContainer.value) {
    canvas.value = new fabric.Canvas('main-canvas', {
      width: canvasContainer.value.clientWidth,
      height: canvasContainer.value.clientHeight,
      backgroundColor: '#f5f7fa',
      selection: false
    })
  }
})

watch(() => props.templateImage, async (newImage) => {
  if (!newImage || !canvas.value) return
  
  try {
    const img = await loadImage(newImage.url)
    
    offscreenCanvas = document.createElement('canvas')
    offscreenCanvas.width = img.width
    offscreenCanvas.height = img.height
    const offscreenCtx = offscreenCanvas.getContext('2d')!
    offscreenCtx.drawImage(img, 0, 0)
    
    templateFabricImage = new fabric.Image(img)
    
    const containerWidth = canvasContainer.value?.clientWidth || 800
    const containerHeight = canvasContainer.value?.clientHeight || 600
    
    const scaleX = containerWidth / img.width
    const scaleY = containerHeight / img.height
    templateScale = Math.min(scaleX, scaleY)
    
    templateFabricImage.scale(templateScale)
    
    const scaledWidth = img.width * templateScale
    const scaledHeight = img.height * templateScale
    templateOffsetX = (containerWidth - scaledWidth) / 2
    templateOffsetY = (containerHeight - scaledHeight) / 2
    
    templateFabricImage.set({
      left: templateOffsetX,
      top: templateOffsetY
    })
    
    canvas.value.clear()
    canvas.value.add(templateFabricImage)
    canvas.value.renderAll()
    
    scale.value = templateScale
    
    await nextTick()
    await detectQRCode()
  } catch (err) {
    setError(err instanceof Error ? err.message : '加载图片失败')
  }
}, { immediate: true })

watch(() => props.qrImage, async (newImage) => {
  if (!newImage || !props.templateImage || !canvas.value) return
  
  try {
    await performComposite()
  } catch (err) {
    setError(err instanceof Error ? err.message : '合成失败')
  }
})

function drawCornersOnOffscreen(corners: QRCodeCorners, color: string = 'red') {
  if (!offscreenCanvas) return
  
  const ctx = offscreenCanvas.getContext('2d')!
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.fillStyle = color
  
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]
  
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.closePath()
  ctx.stroke()
  
  points.forEach((point, idx) => {
    ctx.beginPath()
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2)
    ctx.fill()
    
    ctx.fillStyle = 'white'
    ctx.font = 'bold 16px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${idx + 1}`, point.x, point.y)
    ctx.fillStyle = color
  })
}

async function detectQRCode() {
  if (!canvas.value || !offscreenCanvas) return
  
  setIsDetecting(true)
  
  try {
    const result = await detect(offscreenCanvas)
    
    if (result.success && result.corners) {
      console.log('=== 二维码检测成功 ===')
      console.log('原始角点:', result.corners)
      
      const rawPoints = [
        result.corners.topLeft,
        result.corners.topRight,
        result.corners.bottomRight,
        result.corners.bottomLeft
      ]
      clearQrRegion(offscreenCanvas!, rawPoints, '#ffffff')
      
      drawCornersOnOffscreen(result.corners, 'red')
      
      const debugImg = new Image()
      debugImg.src = offscreenCanvas.toDataURL('image/png')
      debugImg.onload = () => {
        console.log('离屏Canvas状态（已绘制角点）:', debugImg.src.substring(0, 50) + '...')
      }
      
      const displayCorners = convertToDisplayCoords(result.corners)
      console.log('显示角点:', displayCorners)
      console.log('转换参数:', { templateScale, templateOffsetX, templateOffsetY })
      
      setQRCorners(displayCorners)
      emit('corners-detected', displayCorners)
      drawAnchors(displayCorners)
    } else {
      console.log('=== 二维码检测失败 ===')
      setError('未检测到二维码，请手动标记四个角点')
      drawDefaultAnchors()
    }
  } catch (err) {
    console.error('检测异常:', err)
    setError(err instanceof Error ? err.message : '检测失败')
    drawDefaultAnchors()
  } finally {
    setIsDetecting(false)
  }
}

function convertToDisplayCoords(corners: QRCodeCorners): QRCodeCorners {
  return {
    topLeft: {
      x: corners.topLeft.x * templateScale + templateOffsetX,
      y: corners.topLeft.y * templateScale + templateOffsetY
    },
    topRight: {
      x: corners.topRight.x * templateScale + templateOffsetX,
      y: corners.topRight.y * templateScale + templateOffsetY
    },
    bottomLeft: {
      x: corners.bottomLeft.x * templateScale + templateOffsetX,
      y: corners.bottomLeft.y * templateScale + templateOffsetY
    },
    bottomRight: {
      x: corners.bottomRight.x * templateScale + templateOffsetX,
      y: corners.bottomRight.y * templateScale + templateOffsetY
    }
  }
}

function convertToOriginalCoords(point: Point): Point {
  return {
    x: (point.x - templateOffsetX) / templateScale,
    y: (point.y - templateOffsetY) / templateScale
  }
}

function drawAnchors(corners: QRCodeCorners) {
  if (!canvas.value) return
  
  removeAnchors()
  
  const cornerPoints = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft
  ]
  
  cornerPoints.forEach((point, index) => {
    const anchor = new fabric.Circle({
      radius: 8,
      fill: '#3b82f6',
      stroke: '#fff',
      strokeWidth: 2,
      left: point.x,
      top: point.y,
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      hasBorders: false,
      data: { index }
    })
    
    anchor.on('moving', () => {
      updateSelectionArea()
    })
    
    anchorPoints.push(anchor)
    canvas.value!.add(anchor)
  })
  
  canvas.value.renderAll()
  updateSelectionArea()
}

function drawDefaultAnchors() {
  if (!canvas.value || !templateFabricImage) return
  
  const img = templateFabricImage
  const imgWidth = img.width! * img.scaleX!
  const imgHeight = img.height! * img.scaleY!
  const imgLeft = img.left!
  const imgTop = img.top!
  
  const regionWidth = imgWidth * 0.4
  const regionHeight = imgHeight * 0.4
  const regionLeft = imgLeft + (imgWidth - regionWidth) / 2
  const regionTop = imgTop + (imgHeight - regionHeight) / 2
  
  const corners: QRCodeCorners = {
    topLeft: { x: regionLeft, y: regionTop },
    topRight: { x: regionLeft + regionWidth, y: regionTop },
    bottomRight: { x: regionLeft + regionWidth, y: regionTop + regionHeight },
    bottomLeft: { x: regionLeft, y: regionTop + regionHeight }
  }
  
  drawAnchors(corners)
}

function removeAnchors() {
  if (!canvas.value) return
  
  anchorPoints.forEach(anchor => {
    canvas.value!.remove(anchor)
  })
  anchorPoints = []
}

function updateSelectionArea() {
  if (!canvas.value) return
  
  const anchors = anchorPoints.map((anchor, index) => ({
    id: index.toString(),
    x: anchor.left!,
    y: anchor.top!
  }))
  
  const xs = anchors.map(a => a.x)
  const ys = anchors.map(a => a.y)
  
  setSelectionArea({
    anchors,
    bounds: {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys)
    }
  })
}

async function performComposite() {
  if (!canvas.value || !offscreenCanvas || !props.templateImage) return
  
  if (!state.qrContent && !props.qrImage) return
  
  setIsCompositing(true)
  
  try {
    const dstCorners: Point[] = anchorPoints.map(anchor => {
      return convertToOriginalCoords({ x: anchor.left!, y: anchor.top! })
    })
    
    console.log('=== 开始合成 ===')
    console.log('锚点数量:', anchorPoints.length)
    console.log('锚点显示坐标:', anchorPoints.map(a => ({ x: a.left, y: a.top })))
    console.log('目标原始坐标:', dstCorners)
    console.log('离屏Canvas尺寸:', { width: offscreenCanvas.width, height: offscreenCanvas.height })
    
    console.log('步骤0: 重新绘制原始模板图片（清除红线和角标）')
    const originalTemplate = await loadImage(props.templateImage.url)
    const offscreenCtx = offscreenCanvas.getContext('2d')!
    offscreenCtx.drawImage(originalTemplate, 0, 0)
    clearQrRegion(offscreenCanvas, dstCorners, '#ffffff')
    
    let sourceQRImg: HTMLImageElement | null = null
    
    if (state.qrContent) {
      console.log('步骤1: 使用文本内容生成二维码')
      const qrSize = Math.max(256, Math.round(Math.sqrt(
        Math.pow(dstCorners[1].x - dstCorners[0].x, 2) + 
        Math.pow(dstCorners[1].y - dstCorners[0].y, 2)
      )))
      console.log(`生成二维码尺寸: ${qrSize}x${qrSize}`)
      
      const generatedQR = await generateQRCode(state.qrContent, qrSize)
      console.log('生成的二维码图片尺寸:', generatedQR.width, 'x', generatedQR.height)
      sourceQRImg = generatedQR
    } else if (props.qrImage) {
      console.log('步骤1: 加载上传的二维码图片')
      const qrImg = await loadImage(props.qrImage.url)
      console.log('上传的二维码图片尺寸:', qrImg.width, 'x', qrImg.height)
      
      console.log('步骤2: 尝试识别二维码内容')
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = qrImg.width
      tempCanvas.height = qrImg.height
      const tempCtx = tempCanvas.getContext('2d')!
      tempCtx.drawImage(qrImg, 0, 0)
      
      const { detect } = useQRDetect()
      const detectResult = await detect(tempCanvas)
      
      if (detectResult.success && detectResult.data) {
        console.log(`识别成功，重新生成标准二维码: ${detectResult.data.substring(0, 50)}${detectResult.data.length > 50 ? '...' : ''}`)
        const qrSize = Math.max(256, Math.round(Math.sqrt(
          Math.pow(dstCorners[1].x - dstCorners[0].x, 2) + 
          Math.pow(dstCorners[1].y - dstCorners[0].y, 2)
        )))
        const generatedQR = await generateQRCode(detectResult.data, qrSize)
        sourceQRImg = generatedQR
      } else {
        console.log('识别失败，直接使用上传的二维码图片进行合成')
        sourceQRImg = qrImg
      }
    }
    
    if (!sourceQRImg) {
      throw new Error('请提供二维码内容或上传二维码图片')
    }
    
    const generatedImgResult: ImageUploadResult = {
      id: props.qrImage?.id || `${Date.now()}-generated`,
      file: props.qrImage?.file || new File([], 'generated-qr.png', { type: 'image/png' }),
      url: sourceQRImg.src,
      width: sourceQRImg.width,
      height: sourceQRImg.height,
      type: 'qr'
    }
    
    console.log('步骤6: 执行透视变换合成')
    await transform(offscreenCanvas, generatedImgResult, dstCorners)
    
    console.log('步骤7: 更新Fabric画布')
    const compositedDataUrl = offscreenCanvas.toDataURL('image/png')
    console.log('合成后离屏Canvas大小:', compositedDataUrl.length, 'bytes')
    console.log('合成后离屏Canvas:', compositedDataUrl.substring(0, 50) + '...')
    
    const testCtx = offscreenCanvas.getContext('2d')
    const centerX = Math.floor((dstCorners[0].x + dstCorners[1].x + dstCorners[2].x + dstCorners[3].x) / 4)
    const centerY = Math.floor((dstCorners[0].y + dstCorners[1].y + dstCorners[2].y + dstCorners[3].y) / 4)
    const centerPixel = testCtx!.getImageData(centerX, centerY, 1, 1).data
    console.log(`目标区域中心像素(${centerX},${centerY}): R=${centerPixel[0]}, G=${centerPixel[1]}, B=${centerPixel[2]}`)
    
    const compositedImage = new fabric.Image(offscreenCanvas)
    compositedImage.scale(templateScale)
    compositedImage.set({
      left: templateOffsetX,
      top: templateOffsetY
    })
    
    canvas.value.remove(templateFabricImage!)
    templateFabricImage = compositedImage
    canvas.value.add(templateFabricImage)
    
    canvas.value.renderAll()
    console.log('=== 合成完成 ===')
    emit('composite-complete')
  } catch (err) {
    console.error('合成失败:', err)
    throw err
  } finally {
    setIsCompositing(false)
  }
}

function zoomIn() {
  scale.value = Math.min(scale.value + 0.2, 3)
  canvas.value?.setZoom(scale.value)
}

function zoomOut() {
  scale.value = Math.max(scale.value - 0.2, 0.2)
  canvas.value?.setZoom(scale.value)
}

function resetZoom() {
  scale.value = 1
  canvas.value?.setZoom(1)
}

async function reDetect() {
  if (!props.templateImage || !canvas.value) return
  
  setIsDetecting(true)
  
  try {
    const img = await loadImage(props.templateImage.url)
    
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas')
    }
    offscreenCanvas.width = img.width
    offscreenCanvas.height = img.height
    const offscreenCtx = offscreenCanvas.getContext('2d')!
    offscreenCtx.drawImage(img, 0, 0)
    
    removeAnchors()
    
    await detectQRCode()
  } catch (err) {
    console.error('重新检测失败:', err)
    setError(err instanceof Error ? err.message : '重新检测失败')
    setIsDetecting(false)
  }
}

function clearCanvas() {
  canvas.value?.clear()
  removeAnchors()
  templateFabricImage = null
  offscreenCanvas = null
}

function showOffscreenCanvas() {
  if (!offscreenCanvas) return
  
  const dataUrl = offscreenCanvas.toDataURL('image/png')
  const win = window.open('', '_blank')
  if (win) {
    win.document.write(`
      <html>
        <head><title>离屏Canvas内容</title></head>
        <body>
          <h2>离屏Canvas内容 (${offscreenCanvas.width} x ${offscreenCanvas.height})</h2>
          <img src="${dataUrl}" style="max-width: 100%; border: 2px solid #3b82f6;">
        </body>
      </html>
    `)
    win.document.close()
  }
}

defineExpose({
  reDetect,
  clearCanvas,
  performComposite,
  getCanvas: () => offscreenCanvas || canvas.value?.getElement(),
  showOffscreenCanvas
})
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center justify-between mb-4">
      <div class="text-sm font-medium text-gray-700">画布预览</div>
      <div class="flex items-center gap-2">
        <button
          @click="zoomOut"
          class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
          title="缩小"
        >
          <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
          </svg>
        </button>
        <span class="text-xs text-gray-500 w-16 text-center">{{ Math.round(scale * 100) }}%</span>
        <button
          @click="zoomIn"
          class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
          title="放大"
        >
          <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          @click="resetZoom"
          class="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
          title="重置"
        >
          <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </div>
    
    <div ref="canvasContainer" class="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden relative">
      <canvas id="main-canvas" class="w-full h-full"></canvas>
      
      <div v-if="!templateImage" class="absolute inset-0 flex items-center justify-center bg-gray-50">
        <div class="text-center space-y-2">
          <svg class="w-16 h-16 mx-auto text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p class="text-gray-500">请先上传模板图</p>
        </div>
      </div>
      
      <div 
        v-if="templateImage && !state.qrCorners && !state.isDetecting" 
        class="absolute inset-0 pointer-events-none flex items-center justify-center"
      >
        <div class="bg-black/60 text-white px-6 py-4 rounded-xl text-center backdrop-blur-sm">
          <svg class="w-8 h-8 mx-auto mb-2 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-sm font-medium">未检测到二维码</p>
          <p class="text-xs text-gray-300 mt-1">请拖拽蓝色锚点标记二维码区域</p>
        </div>
      </div>
    </div>
  </div>
</template>
