import jsQR from 'jsqr'
import { computeHomography, applyHomography } from './src/utils/perspectiveUtils'
import type { Point } from './src/types'

interface QRCodeCorners {
  topLeft: Point
  topRight: Point
  bottomLeft: Point
  bottomRight: Point
}

function sortCorners(corners: Point[]): QRCodeCorners {
  const sorted = [...corners].sort((a, b) => {
    if (Math.abs(a.y - b.y) < 10) return a.x - b.x
    return a.y - b.y
  })
  const topTwo = sorted.slice(0, 2).sort((a, b) => a.x - b.x)
  const bottomTwo = sorted.slice(2, 4).sort((a, b) => a.x - b.x)
  return {
    topLeft: topTwo[0],
    topRight: topTwo[1],
    bottomLeft: bottomTwo[0],
    bottomRight: bottomTwo[1]
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

function imageToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  return canvas
}

function detectQRCode(canvas: HTMLCanvasElement): QRCodeCorners | null {
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth'
  })
  if (!code) return null

  const allCorners: Point[] = [
    { x: code.location.topLeftCorner.x, y: code.location.topLeftCorner.y },
    { x: code.location.topRightCorner.x, y: code.location.topRightCorner.y },
    { x: code.location.bottomLeftCorner.x, y: code.location.bottomLeftCorner.y },
    { x: code.location.bottomRightCorner.x, y: code.location.bottomRightCorner.y }
  ]
  return sortCorners(allCorners)
}

function drawCorners(canvas: HTMLCanvasElement, corners: QRCodeCorners, color: string = 'red') {
  const ctx = canvas.getContext('2d')!
  ctx.strokeStyle = color
  ctx.lineWidth = 2

  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]
  
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.closePath()
  ctx.stroke()

  points.forEach(point => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2)
    ctx.fill()
  })
}

function bilinearInterpolate(imageData: ImageData, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const width = imageData.width
  const x0 = Math.floor(x)
  const x1 = Math.min(x0 + 1, width - 1)
  const y0 = Math.floor(y)
  const y1 = Math.min(y0 + 1, imageData.height - 1)

  const wx = x - x0
  const wy = y - y0

  const idx00 = (y0 * width + x0) * 4
  const idx10 = (y0 * width + x1) * 4
  const idx01 = (y1 * width + x0) * 4
  const idx11 = (y1 * width + x1) * 4

  return {
    r: Math.round(
      imageData.data[idx00] * (1 - wx) * (1 - wy) +
      imageData.data[idx10] * wx * (1 - wy) +
      imageData.data[idx01] * (1 - wx) * wy +
      imageData.data[idx11] * wx * wy
    ),
    g: Math.round(
      imageData.data[idx00 + 1] * (1 - wx) * (1 - wy) +
      imageData.data[idx10 + 1] * wx * (1 - wy) +
      imageData.data[idx01 + 1] * (1 - wx) * wy +
      imageData.data[idx11 + 1] * wx * wy
    ),
    b: Math.round(
      imageData.data[idx00 + 2] * (1 - wx) * (1 - wy) +
      imageData.data[idx10 + 2] * wx * (1 - wy) +
      imageData.data[idx01 + 2] * (1 - wx) * wy +
      imageData.data[idx11 + 2] * wx * wy
    ),
    a: 255
  }
}

function compositeImage(
  templateCanvas: HTMLCanvasElement,
  qrCanvas: HTMLCanvasElement,
  dstCorners: Point[]
): void {
  const ctx = templateCanvas.getContext('2d')!
  const qrCtx = qrCanvas.getContext('2d')!
  
  const qrImageData = qrCtx.getImageData(0, 0, qrCanvas.width, qrCanvas.height)
  const qrW = qrCanvas.width
  const qrH = qrCanvas.height

  const srcCorners: Point[] = [
    { x: 0, y: 0 },
    { x: qrW, y: 0 },
    { x: qrW, y: qrH },
    { x: 0, y: qrH }
  ]

  const H = computeHomography(srcCorners, dstCorners)

  const xs = dstCorners.map(p => p.x)
  const ys = dstCorners.map(p => p.y)
  const minX = Math.max(0, Math.floor(Math.min(...xs)))
  const maxX = Math.min(templateCanvas.width, Math.ceil(Math.max(...xs)))
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxY = Math.min(templateCanvas.height, Math.ceil(Math.max(...ys)))

  const width = maxX - minX
  const height = maxY - minY

  if (width <= 0 || height <= 0) {
    throw new Error('目标区域无效')
  }

  const imageData = ctx.getImageData(minX, minY, width, height)
  let pixelCount = 0

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const [sx, sy] = applyHomography(H, x, y)
      if (sx >= 0 && sx < qrW && sy >= 0 && sy < qrH) {
        const color = bilinearInterpolate(qrImageData, sx, sy)
        const idx = ((y - minY) * width + (x - minX)) * 4
        imageData.data[idx] = color.r
        imageData.data[idx + 1] = color.g
        imageData.data[idx + 2] = color.b
        imageData.data[idx + 3] = 255
        pixelCount++
      }
    }
  }

  console.log(`合成完成: ${pixelCount} 像素写入`)
  ctx.putImageData(imageData, minX, minY)
}

async function runTest() {
  console.log('=== 二维码替换测试 ===')
  
  const templateFile = document.getElementById('template-input') as HTMLInputElement
  const qrFile = document.getElementById('qr-input') as HTMLInputElement

  if (!templateFile.files || !qrFile.files) {
    console.error('请先选择模板图片和二维码图片')
    return
  }

  const templateUrl = URL.createObjectURL(templateFile.files[0])
  const qrUrl = URL.createObjectURL(qrFile.files[0])

  console.log('\n步骤1: 加载模板图片...')
  const templateImg = await loadImage(templateUrl)
  console.log(`模板尺寸: ${templateImg.width} x ${templateImg.height}`)
  
  const templateCanvas = imageToCanvas(templateImg)

  console.log('\n步骤2: 检测二维码...')
  const corners = detectQRCode(templateCanvas)
  
  if (corners) {
    console.log('检测成功!')
    console.log('角点坐标:', corners)
    drawCorners(templateCanvas, corners, 'red')
  } else {
    console.log('检测失败，使用默认角点')
    const margin = 50
    const defaultCorners: QRCodeCorners = {
      topLeft: { x: margin, y: margin },
      topRight: { x: templateCanvas.width - margin, y: margin },
      bottomLeft: { x: margin, y: templateCanvas.height - margin },
      bottomRight: { x: templateCanvas.width - margin, y: templateCanvas.height - margin }
    }
    console.log('默认角点:', defaultCorners)
    drawCorners(templateCanvas, defaultCorners, 'blue')
  }

  const dstCorners = corners ? [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft] : [
    { x: 50, y: 50 },
    { x: templateCanvas.width - 50, y: 50 },
    { x: templateCanvas.width - 50, y: templateCanvas.height - 50 },
    { x: 50, y: templateCanvas.height - 50 }
  ]

  console.log('\n步骤3: 加载二维码图片...')
  const qrImg = await loadImage(qrUrl)
  console.log(`二维码尺寸: ${qrImg.width} x ${qrImg.height}`)
  
  const qrCanvas = imageToCanvas(qrImg)

  console.log('\n步骤4: 合成图片...')
  console.log('目标角点:', dstCorners)
  
  try {
    compositeImage(templateCanvas, qrCanvas, dstCorners)
    console.log('合成成功!')
    
    const resultDataUrl = templateCanvas.toDataURL('image/png')
    const resultImg = document.createElement('img')
    resultImg.src = resultDataUrl
    resultImg.style.maxWidth = '500px'
    resultImg.style.border = '2px solid #3b82f6'
    resultImg.style.marginTop = '20px'
    
    const container = document.getElementById('result-container')
    if (container) {
      container.innerHTML = '<h3>合成结果:</h3>'
      container.appendChild(resultImg)
    }
    
    console.log('结果已显示在页面上')
  } catch (err) {
    console.error('合成失败:', err)
  }
}

function setupUI() {
  const html = `
    <div style="max-width: 800px; margin: 20px auto;">
      <h1>二维码替换测试</h1>
      <div style="margin-bottom: 20px;">
        <label>模板图片:</label>
        <input type="file" id="template-input" accept="image/*" style="display: block; margin: 5px 0;">
      </div>
      <div style="margin-bottom: 20px;">
        <label>二维码图片:</label>
        <input type="file" id="qr-input" accept="image/*" style="display: block; margin: 5px 0;">
      </div>
      <button onclick="runTest()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">
        开始测试
      </button>
      <div id="result-container"></div>
    </div>
  `
  document.body.innerHTML = html
}

if (typeof window !== 'undefined') {
  window.runTest = runTest
  setupUI()
}

export { runTest, detectQRCode, compositeImage }
