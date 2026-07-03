export interface ErrorInfo {
  type: string
  message: string
  detail?: string
}

export const errorMessages: Record<string, string> = {
  'format-not-supported': '请上传图片文件（支持PNG、JPG、WEBP格式）',
  'size-exceeded': '图片尺寸过大，已自动缩放至2048px以内',
  'resolution-too-low': '二维码分辨率过低，可能导致合成后无法扫描，请上传更高清晰度的二维码',
  'qr-not-detected': '未检测到二维码，请手动标记四个角点',
  'composite-failed': '合成过程中出现错误，请重试',
  'decode-failed': '合成后的二维码无法扫描，请调整标记区域或更换二维码',
  'memory-exceeded': '当前页面内存不足，请刷新后重试',
  'network-error': '图片加载失败，请检查网络或重新上传',
  'unknown': '发生未知错误，请重试'
}

export function getErrorMessage(type: string): string {
  return errorMessages[type] || errorMessages['unknown']
}

export function handleError(error: Error | string): ErrorInfo {
  if (typeof error === 'string') {
    return {
      type: error,
      message: getErrorMessage(error)
    }
  }
  
  let type = 'unknown'
  if (error.message.includes('format')) type = 'format-not-supported'
  else if (error.message.includes('size')) type = 'size-exceeded'
  else if (error.message.includes('memory')) type = 'memory-exceeded'
  else if (error.message.includes('network')) type = 'network-error'
  
  return {
    type,
    message: getErrorMessage(type),
    detail: error.message
  }
}

export function logError(error: Error | string, context?: string): void {
  const errorInfo = typeof error === 'string' ? { message: error } : error
  console.error(`[QRCode Replacer Error] ${context || ''}`, errorInfo)
}
