import type { Point, ImageDataWrapper, RGBA, QRCodeCorners } from '@/types';

/**
 * 将任意顺序的 4 个点重排为：TL → TR → BR → BL（屏幕坐标系顺时针沿凸四边形走）
 *
 * 算法（比单看 next.x > prev.x 更稳健，对透视变形的四边形也成立）：
 *  1) 去重（距离 < 2px 视为同一点）
 *  2) 按质心极角升序排序 → 得到一个循环有序序列
 *  3) 用相邻叉积之和 (有向面积) 判断当前方向：正 → 屏幕顺时针；负 → 数学逆时针
 *  4) 若为逆时针则反转为顺时针
 *  5) 找到 "最靠上 (y 最小) 的点" 作为 TL，循环旋转使其成为起点
 *
 * 这是整个合成流程中**最重要**的守卫 —— 无论 anchor 拖动顺序、
 * 检测算法返回的顺序如何，最终都会被规范化为标准的 4 角点。
 */
export function normalizeCorners(points: Point[]): Point[] {
  if (!points || points.length < 4) {
    console.warn('[perspectiveUtils] normalizeCorners: 输入点少于 4 个，原样返回')
    return points
  }

  // 1) 去重
  const EPS = 2
  const unique: Point[] = []
  for (const p of points) {
    if (!unique.some((q) => Math.abs(q.x - p.x) < EPS && Math.abs(q.y - p.y) < EPS)) {
      unique.push(p)
    }
  }
  const pts = unique.length >= 4 ? unique : points.slice(0, 4)

  // 2) 质心 + 按极角升序排序
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const withAngle = pts.map((p) => ({
    p,
    angle: Math.atan2(p.y - cy, p.x - cx)
  }))
  withAngle.sort((a, b) => a.angle - b.angle)
  let ordered = withAngle.map((w) => w.p)

  // 3) 用相邻叉积之和判定方向：屏幕坐标系中 顺时针 的有向面积为正
  //    sum = Σ (x_i * y_{i+1} - x_{i+1} * y_i)
  let signed = 0
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]
    const b = ordered[(i + 1) % ordered.length]
    signed += a.x * b.y - b.x * a.y
  }
  // 4) 若为负（数学逆时针 = 屏幕也逆时针），则反转 → 得到顺时针
  if (signed < 0) ordered = ordered.slice().reverse()

  // 5) 找到 y 最小的点作为 TL，循环旋转起点
  let topIdx = 0
  let minY = Infinity
  ordered.forEach((p, i) => {
    if (p.y < minY) { minY = p.y; topIdx = i }
  })
  const n = ordered.length
  const rotated: Point[] = []
  for (let i = 0; i < n; i++) rotated.push(ordered[(topIdx + i) % n])

  return rotated
}

/**
 * 将 QRCodeCorners 展开为 Point[]，顺序固定为 [TL, TR, BR, BL]
 */
export function flattenCorners(corners: QRCodeCorners): Point[] {
  return [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]
}

/**
 * 计算 4 个点的形状健康度（0~1，越接近 1 越像正方形/矩形）
 * - 检查是否 3 点共线、是否四边形面积合理、是否凹四边形等
 */
export function checkQuadHealth(points: Point[]): { healthy: boolean; score: number; reason?: string } {
  if (!points || points.length < 4) {
    return { healthy: false, score: 0, reason: '点数量不足 4 个' }
  }
  const [p0, p1, p2, p3] = points
  const d01 = Math.hypot(p0.x - p1.x, p0.y - p1.y)
  const d12 = Math.hypot(p1.x - p2.x, p1.y - p2.y)
  const d23 = Math.hypot(p2.x - p3.x, p2.y - p3.y)
  const d30 = Math.hypot(p3.x - p0.x, p3.y - p0.y)
  const avg = (d01 + d12 + d23 + d30) / 4
  if (avg < 5) {
    return { healthy: false, score: 0, reason: `平均边长仅 ${avg.toFixed(1)}px，角点可能都挤在一起` }
  }
  // 最短边 / 最长边 应该接近 1
  const minS = Math.min(d01, d12, d23, d30)
  const maxS = Math.max(d01, d12, d23, d30)
  const ratio = minS / maxS
  if (ratio < 0.3) {
    return { healthy: false, score: ratio, reason: `边长比 ${ratio.toFixed(2)} < 0.3，形状异常` }
  }
  return { healthy: true, score: ratio }
}

export function computeHomography(
  srcPoints: Point[],
  dstPoints: Point[]
): number[] {
  if (srcPoints.length !== 4 || dstPoints.length !== 4) {
    throw new Error('需要4个对应点')
  }

  // ----------------------------------------------------------------
  // 关键修复：Hartley 归一化 + 固定 h9=1 的直接线性求解
  //
  // 之前的 SVD 零空间解法在"两个轴对齐矩形"这类退化情形下，
  // 会把 h9≈0 的退化解当作最小奇异值解返回 → 单应性矩阵
  // 产生万亿像素级的错误。
  //
  // 现在的算法：
  //   1) 对 src / dst 各自做 Hartley 归一化（点平移 + 缩放 ~sqrt(2)）
  //      使求解方程的条件数稳定在 ~O(1)
  //   2) 在归一化坐标下，用 "h9=1" 的 8×8 线性方程组直接求解
  //      (等价于 DLT + 一个合理的尺度固定)
  //   3) 反归一化： H = T_dst^{-1} · H' · T_src
  // ----------------------------------------------------------------

  const Tsrc = normalizePoints(srcPoints)
  const Tdst = normalizePoints(dstPoints)
  const normSrc = srcPoints.map(p => applyTransform(Tsrc, p))
  const normDst = dstPoints.map(p => applyTransform(Tdst, p))

  // 在归一化坐标下构造 8x8 矩阵，令 h9 = 1
  // 原方程: h0*x + h1*y + h2 - u*(h6*x + h7*y + 1) = 0
  //       : h3*x + h4*y + h5 - v*(h6*x + h7*y + 1) = 0
  // 整理为关于 [h0..h7] 的 8x8 线性方程组 B·h = rhs
  const B: number[][] = []
  const rhs: number[] = []
  for (let i = 0; i < 4; i++) {
    const x = normSrc[i].x
    const y = normSrc[i].y
    const u = normDst[i].x
    const v = normDst[i].y
    // 第一行: h0*x + h1*y + h2 + 0 + 0 + 0 - h6*u*x - h7*u*y = u
    B.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    rhs.push(u)
    // 第二行: 0 + 0 + 0 + h3*x + h4*y + h5 - h6*v*x - h7*v*y = v
    B.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    rhs.push(v)
  }

  // 8x8 线性方程组：用高斯-约当消元求逆
  const Hnorm = solve8x8(B, rhs)
  const H9 = [...Hnorm, 1.0] // 归一化坐标系下的 9 参数

  // 反归一化：H = inv(Tdst) · Hnorm · Tsrc
  // Hnorm 是 3x3 矩阵（行优先 [h0..h8]），Tsrc/Tdst 也是 3x3 矩阵:
  //   [s, 0, tx]   [0, s, ty]   [0, 0, 1]
  const H = denormalizeHomography(Tsrc, Tdst, H9)

  // 简单误差检查（只在必要时告警）
  let totalError = 0
  let maxError = 0
  for (let i = 0; i < 4; i++) {
    const [x, y] = [srcPoints[i].x, srcPoints[i].y]
    const [u, v] = [dstPoints[i].x, dstPoints[i].y]
    const denom = H[6] * x + H[7] * y + H[8]
    if (Math.abs(denom) < 1e-12) continue
    const uPred = (H[0] * x + H[1] * y + H[2]) / denom
    const vPred = (H[3] * x + H[4] * y + H[5]) / denom
    const error = Math.sqrt((u - uPred) ** 2 + (v - vPred) ** 2)
    totalError += error
    if (error > maxError) maxError = error
  }
  const avgError = totalError / 4
  if (avgError > 5) {
    console.warn(`[perspectiveUtils] 单应性矩阵平均误差 ${avgError.toFixed(2)}px (max=${maxError.toFixed(2)}px)`)
  }

  return H
}

// ---------- Hartley 归一化相关工具 ----------
interface Transform2D { s: number; tx: number; ty: number } // 代表 diag(s,s,1)·translate(tx,ty)

function normalizePoints(pts: Point[]): Transform2D {
  let mx = 0, my = 0
  for (const p of pts) { mx += p.x; my += p.y }
  mx /= pts.length; my /= pts.length
  let dsum = 0
  for (const p of pts) dsum += Math.hypot(p.x - mx, p.y - my)
  const mean = dsum / pts.length
  const s = mean > 1e-9 ? Math.SQRT2 / mean : 1
  return { s, tx: -s * mx, ty: -s * my }
}

function applyTransform(T: Transform2D, p: Point): Point {
  return { x: T.s * p.x + T.tx, y: T.s * p.y + T.ty }
}

/**
 * H9 是归一化坐标系下的 3x3 单应性矩阵（行优先 [h0..h8]）。
 * Tsrc / Tdst 都形如：
 *   [s  0  tx]
 *   [0  s  ty]
 *   [0  0   1]
 * 原始坐标下的单应性矩阵为：H = inv(Tdst) · H9 · Tsrc。
 * 直接用通用 3x3 矩阵乘法，避免手写展开出错。
 */
function denormalizeHomography(Tsrc: Transform2D, Tdst: Transform2D, H9: number[]): number[] {
  const matTsrc = [Tsrc.s, 0, Tsrc.tx, 0, Tsrc.s, Tsrc.ty, 0, 0, 1];
  const invTdst = (() => {
    const i = 1 / Tdst.s;
    return [i, 0, -Tdst.tx * i, 0, i, -Tdst.ty * i, 0, 0, 1];
  })();
  const step = mat3mul(H9, matTsrc);
  const H = mat3mul(invTdst, step);
  const sc = H[8];
  if (Math.abs(sc) < 1e-12) return H;
  return H.map(v => v / sc);
}

function mat3mul(A: number[], B: number[]): number[] {
  const C: number[] = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j];
      C[i * 3 + j] = s;
    }
  }
  return C;
}

// ---------- 8x8 线性方程组求解（高斯-约当） ----------
function solve8x8(A: number[][], b: number[]): number[] {
  const n = 8
  // 构造增广矩阵 (n x n+1)
  const M: number[][] = []
  for (let i = 0; i < n; i++) {
    const row = new Array(n + 1)
    for (let j = 0; j < n; j++) row[j] = A[i][j]
    row[n] = b[i]
    M.push(row)
  }

  for (let col = 0; col < n; col++) {
    // 部分主元
    let pivRow = col
    let piv = Math.abs(M[col][col])
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col])
      if (v > piv) { piv = v; pivRow = r }
    }
    if (piv < 1e-14) {
      // 列奇异：退化为 SVD 求最小范数解以兜底
      return solveByPseudoInverse(A, b)
    }
    if (pivRow !== col) {
      const tmp = M[col]; M[col] = M[pivRow]; M[pivRow] = tmp
    }
    const pv = M[col][col]
    for (let j = col; j <= n; j++) M[col][j] /= pv
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col]
      if (factor === 0) continue
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j]
    }
  }
  const x: number[] = new Array(n)
  for (let i = 0; i < n; i++) x[i] = M[i][n]
  return x
}

// 兜底：对 A·x = b 求最小范数最小二乘解（A 奇异时使用）
function solveByPseudoInverse(A: number[][], b: number[]): number[] {
  const n = A.length
  // 构造正规方程 A^T A · x = A^T b + μI · x（Tikhonov）
  const mu = 1e-6
  const AtA: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const Atb: number[] = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0
      for (let k = 0; k < n; k++) s += A[k][i] * A[k][j]
      AtA[i][j] = s
    }
    let s = 0
    for (let k = 0; k < n; k++) s += A[k][i] * b[k]
    Atb[i] = s
  }
  for (let i = 0; i < n; i++) AtA[i][i] += mu
  // 对对称正定的 AtA 再次用 Gauss-Jordan
  return solve8x8(AtA, Atb)
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

  // ====== 关键修复：规范化 4 个角点的顺序（TL → TR → BR → BL）
  // 无论 anchor 拖动顺序如何，都重新计算凸四边形的顺时针角点
  const orderedCorners = normalizeCorners(dstCorners)
  const health = checkQuadHealth(orderedCorners)
  if (!health.healthy) {
    console.warn(`[perspectiveUtils] 角点形状不合法：${health.reason}`)
  }
  // 记录规范化前后差异以便调试
  const flatOrig = dstCorners.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(' | ')
  const flatOrdered = orderedCorners.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(' | ')
  if (flatOrig !== flatOrdered) {
    console.log(`[perspectiveUtils] 角点顺序已规范化：原=[${flatOrig}] → 新=[${flatOrdered}]`)
  }

  const qrData = getImageDataFromImage(qrImage)
  const qrW = qrImage.width
  const qrH = qrImage.height

  const srcCorners: Point[] = [
    { x: 0, y: 0 },
    { x: qrW, y: 0 },
    { x: qrW, y: qrH },
    { x: 0, y: qrH }
  ]

  // 注意：computeHomography(src, dst) 求的是 src → dst 的映射 H。
  // 这里我们要把"目标角点"映射回"源二维码四角"，所以用 (dst, src)
  const H_inv = computeHomography(orderedCorners, srcCorners)

  const xs = orderedCorners.map(p => p.x)
  const ys = orderedCorners.map(p => p.y)
  const minX = Math.max(0, Math.floor(Math.min(...xs)))
  const maxX = Math.min(templateCanvas.width, Math.ceil(Math.max(...xs)))
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxY = Math.min(templateCanvas.height, Math.ceil(Math.max(...ys)))

  const width = maxX - minX
  const height = maxY - minY

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

  const totalPixels = width * height
  const coverage = pixelCount / totalPixels
  if (coverage < 0.1) {
    console.warn(`[perspectiveUtils] 像素覆盖不足 (${(coverage * 100).toFixed(1)}%)，可能坐标映射有问题`)
  } else if (pixelCount === 0) {
    console.error(`[perspectiveUtils] 没有写入任何像素！请检查单应性矩阵计算`)
  }

  ctx.putImageData(imageData, minX, minY)
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
}
