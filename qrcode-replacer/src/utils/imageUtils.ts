import type { ImageUploadResult, ImageUploadOptions, ImageDataWrapper, RGBA } from '@/types'

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function validateImage(file: File, options?: ImageUploadOptions): { valid: boolean; error?: string } {
  const defaultOptions: ImageUploadOptions = {
    maxSize: 2048,
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp']
  }
  const opts = { ...defaultOptions, ...options }

  if (!opts.allowedTypes.includes(file.type)) {
    return { valid: false, error: '请上传图片文件（支持PNG、JPG、WEBP格式）' }
  }

  return { valid: true }
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

export async function getImageDataFromFile(file: File): Promise<ImageUploadResult> {
  const url = URL.createObjectURL(file)
  const img = await loadImage(url)
  
  return {
    id: generateId(),
    file,
    url,
    width: img.width,
    height: img.height,
    type: 'template'
  }
}

export function getImageDataFromImage(image: HTMLImageElement): ImageDataWrapper {
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

export async function resizeImage(image: HTMLImageElement, maxSize: number): Promise<HTMLImageElement> {
  let { width, height } = image
  
  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }
  
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)
  
  return new Promise((resolve, reject) => {
    const result = new Image()
    result.onload = () => resolve(result)
    result.onerror = () => reject(new Error('图像加载失败'))
    result.src = canvas.toDataURL('image/png')
  })
}

export function getPixelColor(imageData: ImageDataWrapper, x: number, y: number): RGBA {
  const idx = (Math.floor(y) * imageData.width + Math.floor(x)) * 4
  return {
    r: imageData.data[idx],
    g: imageData.data[idx + 1],
    b: imageData.data[idx + 2],
    a: imageData.data[idx + 3]
  }
}

export function applyEdgeBlending(
  imageData: ImageDataWrapper,
  radius: number
): ImageDataWrapper {
  const result = new Uint8ClampedArray(imageData.data.length)
  result.set(imageData.data)
  
  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const distToEdge = Math.min(
        x,
        imageData.width - 1 - x,
        y,
        imageData.height - 1 - y
      )
      
      if (distToEdge < radius) {
        const alpha = (distToEdge / radius) * 255
        const idx = (y * imageData.width + x) * 4
        result[idx + 3] = alpha
      }
    }
  }
  
  return { ...imageData, data: result }
}
