export interface Point {
  x: number
  y: number
}

export interface QRCodeCorners {
  topLeft: Point
  topRight: Point
  bottomLeft: Point
  bottomRight: Point
}

export interface ImageUploadResult {
  id: string
  file: File
  url: string
  width: number
  height: number
  type: 'template' | 'qr'
}

export interface ImageUploadOptions {
  maxSize: number
  minWidth?: number
  minHeight?: number
  allowedTypes: string[]
}

export interface QRDetectResult {
  success: boolean
  corners?: QRCodeCorners
  data?: string
  error?: string
  method?: 'jsqr' | 'finder-pattern' | 'image-feature'
}

export interface AnchorPosition {
  id: string
  x: number
  y: number
}

export interface SelectionArea {
  anchors: AnchorPosition[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

export interface ImageDataWrapper {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface TransformMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  g: number
  h: number
}

export interface ExportOptions {
  format: 'png' | 'jpg'
  quality?: number
  filename?: string
}

export interface HistoryEntry {
  state: Partial<AppState>
  timestamp: number
}

export interface AppState {
  templateImage: ImageUploadResult | null
  qrImage: ImageUploadResult | null
  qrContent: string
  qrCorners: QRCodeCorners | null
  selectionArea: SelectionArea | null
  isDetecting: boolean
  isCompositing: boolean
  error: string | null
  history: HistoryEntry[]
}

export interface AppEvents {
  'image-uploaded': (result: ImageUploadResult) => void
  'qr-detected': (result: QRDetectResult) => void
  'selection-changed': (area: SelectionArea) => void
  'composite-complete': () => void
  'error': (message: string) => void
}
