import type { Point, ImageDataWrapper, RGBA } from '@/types'
import { Matrix, SVD } from 'ml-matrix'

export function computeHomography(
  srcPoints: Point[],
  dstPoints: Point[]
): number[] {
  if (srcPoints.length !== 4 || dstPoints.length !== 4) {
    throw new Error('需要4个对应点')
  }

  const A: number[][] = []

  for (let i = 0; i < 4; i++) {
    const [x, y] = [srcPoints[i].x, srcPoints[i].y]
    const [u, v] = [dstPoints[i].x, dstPoints[i].y]

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
  }

  const matrixA = new Matrix(A)
  const svd = new SVD(matrixA)
  
  const V = svd.rightSingularVectors
  const lastCol = V.getColumn(V.columns - 1)
  
  const scale = lastCol[8] || 1
  const H: number[] = lastCol.map((v: number) => v / scale)

  console.log('=== 单应性矩阵验证 ===')
  let totalError = 0
  for (let i = 0; i < 4; i++) {
    const [x, y] = [srcPoints[i].x, srcPoints[i].y]
    const [u, v] = [dstPoints[i].x, dstPoints[i].y]
    
    const denom = H[6] * x + H[7] * y + H[8]
    const uPred = (H[0] * x + H[1] * y + H[2]) / denom
    const vPred = (H[3] * x + H[4] * y + H[5]) / denom
    
    const error = Math.sqrt(Math.pow(u - uPred, 2) + Math.pow(v - vPred, 2))
    totalError += error
    console.log(`点 ${i + 1}: 预测(${uPred.toFixed(2)}, ${vPred.toFixed(2)}) 实际(${u}, ${v}) 误差: ${error.toFixed(2)}px`)
  }
  console.log(`平均误差: ${(totalError / 4).toFixed(2)}px`)

  return H
}

export function applyHomography(
  H: number[],
  x: number,
  y: number
): [number, number] {
  const denom = H[6] * x + H[7] * y + H[8]
  if (Math.abs(denom) < 1e-10) {
    return [x, y]
  }
  const u = (H[0] * x + H[1] * y + H[2]) / denom
  const v = (H[3] * x + H[4] * y + H[5]) / denom
  return [u, v]
}

export function computePerspectiveTransform(
  srcPoints: Point[],
  dstPoints: Point[]
): (x: number, y: number) => [number, number] {
  const H = computeHomography(srcPoints, dstPoints)
  return (x, y) => applyHomography(H, x, y)
}

export function computeInverseTransform(
  srcPoints: Point[],
  dstPoints: Point[]
): (x: number, y: number) => [number, number] {
  return computePerspectiveTransform(dstPoints, srcPoints)
}

export function bilinearInterpolate(
  imageData: ImageDataWrapper,
  x: number,
  y: number
): RGBA {
  const x0 = Math.floor(x)
  const x1 = Math.min(x0 + 1, imageData.width - 1)
  const y0 = Math.floor(y)
  const y1 = Math.min(y0 + 1, imageData.height - 1)

  const wx = x - x0
  const wy = y - y0

  const idx00 = (y0 * imageData.width + x0) * 4
  const idx10 = (y0 * imageData.width + x1) * 4
  const idx01 = (y1 * imageData.width + x0) * 4
  const idx11 = (y1 * imageData.width + x1) * 4

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

export function compositeImage(
  templateCanvas: HTMLCanvasElement,
  qrImage: HTMLImageElement,
  dstCorners: Point[]
): void {
  const ctx = templateCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return

  const qrData = getImageDataFromImage(qrImage)
  const qrW = qrImage.width
  const qrH = qrImage.height

  console.log('compositeImage called:', {
    templateSize: { width: templateCanvas.width, height: templateCanvas.height },
    qrSize: { width: qrW, height: qrH },
    dstCorners
  })

  const srcCorners: Point[] = [
    { x: 0, y: 0 },
    { x: qrW, y: 0 },
    { x: qrW, y: qrH },
    { x: 0, y: qrH }
  ]

  const H_inv = computeHomography(dstCorners, srcCorners)

  console.log('=== 逆变换验证 ===')
  let totalInvError = 0
  for (let i = 0; i < 4; i++) {
    const [dx, dy] = [dstCorners[i].x, dstCorners[i].y]
    const [sx, sy] = [srcCorners[i].x, srcCorners[i].y]
    
    const denom = H_inv[6] * dx + H_inv[7] * dy + H_inv[8]
    const sxPred = (H_inv[0] * dx + H_inv[1] * dy + H_inv[2]) / denom
    const syPred = (H_inv[3] * dx + H_inv[4] * dy + H_inv[5]) / denom
    
    const error = Math.sqrt(Math.pow(sx - sxPred, 2) + Math.pow(sy - syPred, 2))
    totalInvError += error
    console.log(`角点 ${i + 1}: 预测源坐标(${sxPred.toFixed(2)}, ${syPred.toFixed(2)}) 实际(${sx}, ${sy}) 误差: ${error.toFixed(2)}px`)
  }
  console.log(`逆变换平均误差: ${(totalInvError / 4).toFixed(2)}px`)

  const xs = dstCorners.map(p => p.x)
  const ys = dstCorners.map(p => p.y)
  const minX = Math.max(0, Math.floor(Math.min(...xs)))
  const maxX = Math.min(templateCanvas.width, Math.ceil(Math.max(...xs)))
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxY = Math.min(templateCanvas.height, Math.ceil(Math.max(...ys)))

  const width = maxX - minX
  const height = maxY - minY

  console.log('Destination region:', {
    minX, maxX, minY, maxY,
    width, height
  })

  if (width <= 0 || height <= 0) {
    throw new Error('目标区域无效：宽度或高度为0')
  }

  const imageData = ctx.getImageData(minX, minY, width, height)
  let pixelCount = 0

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const [sx, sy] = applyHomography(H_inv, x, y)
      if (sx >= 0 && sx < qrW && sy >= 0 && sy < qrH) {
        const color = bilinearInterpolate(qrData, sx, sy)
        const idx = ((y - minY) * width + (x - minX)) * 4
        imageData.data[idx] = color.r
        imageData.data[idx + 1] = color.g
        imageData.data[idx + 2] = color.b
        imageData.data[idx + 3] = 255
        pixelCount++
      }
    }
  }

  console.log(`compositeImage completed: ${pixelCount} pixels written`)
  
  const totalPixels = width * height
  const coverage = ((pixelCount / totalPixels) * 100).toFixed(1)
  console.log(`覆盖比例: ${coverage}% (${pixelCount}/${totalPixels})`)
  
  if (pixelCount === 0) {
    console.error('ERROR: 没有写入任何像素！请检查单应性矩阵计算')
  } else if (pixelCount < totalPixels * 0.5) {
    console.warn(`WARNING: 像素覆盖不足50%，可能存在坐标映射问题`)
  }
  
  ctx.putImageData(imageData, minX, minY)
  
  const testPixel = ctx.getImageData(minX + Math.floor(width/2), minY + Math.floor(height/2), 1, 1).data
  console.log(`中心像素颜色: R=${testPixel[0]}, G=${testPixel[1]}, B=${testPixel[2]}`)
}

function getImageDataFromImage(image: HTMLImageElement): ImageDataWrapper {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, image.width, image.height)

  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data
  }
}

export function clearQrRegion(
  canvas: HTMLCanvasElement,
  corners: Point[],
  color: string = '#ffffff'
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const xs = corners.map(p => p.x)
  const ys = corners.map(p => p.y)
  const minX = Math.max(0, Math.floor(Math.min(...xs)))
  const maxX = Math.min(canvas.width, Math.ceil(Math.max(...xs)))
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxY = Math.min(canvas.height, Math.ceil(Math.max(...ys)))

  ctx.save()
  
  ctx.beginPath()
  ctx.moveTo(corners[0].x, corners[0].y)
  ctx.lineTo(corners[1].x, corners[1].y)
  ctx.lineTo(corners[2].x, corners[2].y)
  ctx.lineTo(corners[3].x, corners[3].y)
  ctx.closePath()
  
  ctx.fillStyle = color
  ctx.fill()
  
  ctx.restore()

  console.log(`QR region cleared: ${minX},${minY} to ${maxX},${maxY}`)
}
