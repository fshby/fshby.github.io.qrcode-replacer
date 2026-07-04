import type { Point, QRCodeCorners } from '@/types';
import { normalizeCorners } from '@/utils/perspectiveUtils';

// ========== 日志控制：默认精简输出，仅错误/警告输出到 console ==========
const DEBUG = false;
const info = (msg: string, ...args: unknown[]) => { if (DEBUG) console.log(msg, ...args); };
const warn = (msg: string, ...args: unknown[]) => console.warn(`[QRDetector] ${msg}`, ...args);

// ========== 1. 图像预处理：Otsu 二值化 ==========

function getLuminance(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const idx = (y * width + x) * 4;
  return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
}

/**
 * Otsu 阈值二值化（带调试统计）
 * - AI 生图通常有噪声/渐变，这里加了局部直方图阈值检查
 */
function otsuThreshold(data: Uint8ClampedArray, width: number, height: number): number {
  const histogram = new Uint32Array(256);
  const pixelCount = width * height;

  let minLum = 255, maxLum = 0, avgLum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const lum = Math.round((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
    histogram[lum]++;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
    avgLum += lum;
  }
  avgLum = Math.round(avgLum / pixelCount);

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = pixelCount - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);

    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  const fgCount = histogram.slice(0, threshold).reduce((a, b) => a + b, 0);
  const fgRatio = fgCount / pixelCount;
  info(`[Step 1] 二值化: ${width}×${height}, 阈值=${threshold}, 前景=${(fgRatio * 100).toFixed(1)}%`);
  if (fgRatio < 0.05 || fgRatio > 0.95) {
    warn(`前景比例异常 (${(fgRatio * 100).toFixed(1)}%)，可能不像二维码`);
  }
  return threshold;
}

/**
 * 生成二值图像并统计纹理密度
 */
function binarize(data: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8Array {
  const result = new Uint8Array(width * height);
  let zeroCrossings = 0;
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    result[i] = lum < threshold ? 1 : 0;
    if (i > 0 && i % width !== 0 && result[i] !== result[i - 1]) zeroCrossings++;
  }
  const density = (zeroCrossings / (width * height) * 100).toFixed(2);
  info(`  水平黑白变化: ${zeroCrossings}, 纹理密度: ~${density}%`);
  return result;
}

// ========== 2. 网格密度热力图 ==========

function computeModuleDensityMap(
  binary: Uint8Array,
  width: number,
  height: number,
  cellSize: number
): { density: Float32Array; gridW: number; gridH: number } {
  const gridW = Math.ceil(width / cellSize);
  const gridH = Math.ceil(height / cellSize);
  const density = new Float32Array(gridW * gridH);

  let maxLocalDensity = 0;

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = gx * cellSize;
      const y0 = gy * cellSize;
      const x1 = Math.min(x0 + cellSize, width);
      const y1 = Math.min(y0 + cellSize, height);

      let transitions = 0;
      let prev: number | null = null;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const v = binary[y * width + x];
          if (prev !== null && v !== prev) transitions++;
          prev = v;
        }
        prev = null;
      }

      const cellPixels = ((x1 - x0) / 2) * ((y1 - y0) / 2);
      const score = Math.min(100, (transitions / Math.max(1, cellPixels)) * 200);
      density[gy * gridW + gx] = score;
      if (score > maxLocalDensity) maxLocalDensity = score;
    }
  }

  info(`[Step 2] 密度热力图: ${gridW}×${gridH}, 峰值=${maxLocalDensity.toFixed(1)}`);
  return { density, gridW, gridH };
}

function findQRRegionFromDensity(
  density: Float32Array,
  gridW: number,
  gridH: number,
  cellSize: number,
  imageW: number,
  imageH: number
): { corners: Point[]; confidence: number } | null {
  const sorted = [...density].sort((a, b) => b - a);
  const threshold = sorted[Math.floor(sorted.length * 0.3)];
  info(`  密度阈值(前30%): ${threshold.toFixed(1)}`);
  if (threshold < 20) {
    warn(`密度太低 (${threshold.toFixed(1)}), 图像太平滑，不像二维码纹理`);
    return null;
  }

  const highDensityCount = density.filter((d) => d >= threshold).length;
  info(`  高纹理格子数: ${highDensityCount} (${(highDensityCount / density.length * 100).toFixed(1)}%)`);

  const regionMap = new Uint8Array(gridW * gridH);
  for (let i = 0; i < density.length; i++) regionMap[i] = density[i] >= threshold ? 1 : 0;

  const labels = new Int32Array(gridW * gridH);
  const regions: { minX: number; minY: number; maxX: number; maxY: number; count: number; score: number }[] = [];
  let labelCount = 0;

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const gIdx = gy * gridW + gx;
      if (regionMap[gIdx] === 1 && labels[gIdx] === 0) {
        labelCount++;
        const stack: [number, number][] = [[gx, gy]];
        let count = 0, minX = gx, maxX = gx, minY = gy, maxY = gy;
        let densitySum = 0;
        while (stack.length > 0) {
          const [x, y] = stack.pop()!;
          const idx = y * gridW + x;
          if (x < 0 || x >= gridW || y < 0 || y >= gridH || labels[idx] !== 0 || regionMap[idx] === 0) continue;
          labels[idx] = labelCount;
          count++;
          densitySum += density[idx];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
        const wCells = maxX - minX + 1, hCells = maxY - minY + 1;
        const aspect = wCells / hCells;
        // 宽高比越接近 1，得分越高
        const aspectScore = 1 - Math.abs(aspect - 1) / Math.max(aspect, 1);
        const avgDensity = densitySum / count;
        regions.push({ minX, minY, maxX, maxY, count, score: aspectScore * avgDensity });
      }
    }
  }

  info(`  连通区域数: ${regions.length} 个`);
  if (regions.length === 0) return null;

  // 按综合得分排序（不再只看宽高比）
  regions.sort((a, b) => b.score - a.score);

  const best = regions[0];
  const pad = 1;
  const x0 = Math.max(0, (best.minX - pad) * cellSize);
  const y0 = Math.max(0, (best.minY - pad) * cellSize);
  const x1 = Math.min(imageW, (best.maxX + 1 + pad) * cellSize);
  const y1 = Math.min(imageH, (best.maxY + 1 + pad) * cellSize);

  const corners: Point[] = [
    { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }
  ];

  const regionRatio = best.count / (gridW * gridH);
  const confidence = Math.min(100, regionRatio * 300);
  info(`  → 选中 ROI: (${x0},${y0})-(${x1},${y1}), 置信度=${confidence.toFixed(1)}`);

  return { corners, confidence };
}

// ========== 3. Finder Pattern 检测 ==========

interface FinderCandidate { center: Point; size: number; score: number; }

/**
 * 扫一条水平线，找 1:1:3:1:1 比例的 Finder Pattern
 * AI 生图通常有模糊/渐变，放宽 tolerance 到 0.7
 */
function scanOneLine(binary: Uint8Array, width: number, startX: number, y: number, maxX: number): { centerX: number; size: number; score: number; endX: number } | null {
  let x = startX;
  while (x < maxX && binary[y * width + x] === 0) x++;
  if (x >= maxX) return null;
  const segments: number[] = [];
  let currentColor = binary[y * width + x];
  let segStart = x;
  for (; x < maxX && segments.length < 5; x++) {
    const v = binary[y * width + x];
    if (v !== currentColor) { segments.push(x - segStart); currentColor = v; segStart = x; }
  }
  if (segments.length < 5) return null;
  const [s1, s2, s3, s4, s5] = segments;
  const total = s1 + s2 + s3 + s4 + s5;
  if (total < 10) return null; // 更小图案也允许（AI 生图可能缩小）
  const unit = total / 7;
  const tolerance = unit * 0.7; // AI 模糊容忍度调高
  if (Math.abs(s1 - unit) < tolerance && Math.abs(s2 - unit) < tolerance &&
      Math.abs(s3 - unit * 3) < tolerance * 1.7 &&
      Math.abs(s4 - unit) < tolerance && Math.abs(s5 - unit) < tolerance &&
      s1 >= 1 && s5 >= 1 && s3 >= 3) {
    const centerX = segStart + s1 + s2 + s3 / 2;
    return { centerX, size: total, score: 10, endX: x };
  }
  return null;
}

/**
 * 扫一条垂直线，同样放宽比例
 */
function scanOneColumn(binary: Uint8Array, width: number, _height: number, x: number, y: number, minY: number, maxY: number): { centerY: number; size: number; score: number } | null {
  let yy = y;
  while (yy > minY && binary[yy * width + x] === 0) yy--;
  const segments: number[] = [];
  let currentColor = binary[yy * width + x];
  let segStart = yy;
  for (; yy < maxY && segments.length < 5; yy++) {
    const v = binary[yy * width + x];
    if (v !== currentColor) { segments.push(yy - segStart); currentColor = v; segStart = yy; }
  }
  if (segments.length < 5) return null;
  const [s1, s2, s3, s4, s5] = segments;
  const total = s1 + s2 + s3 + s4 + s5;
  if (total < 10) return null;
  const unit = total / 7;
  const tolerance = unit * 0.7;
  if (Math.abs(s1 - unit) < tolerance && Math.abs(s2 - unit) < tolerance &&
      Math.abs(s3 - unit * 3) < tolerance * 1.7 &&
      Math.abs(s4 - unit) < tolerance && Math.abs(s5 - unit) < tolerance) {
    return { centerY: segStart + s1 + s2 + s3 / 2, size: total, score: 10 };
  }
  return null;
}

/**
 * Finder Pattern 检测 —— 对 AI 生图：
 * - 扫描步长更小（找更多候选）
 * - 垂直验证放宽（size 差容忍 0.5）
 * - 去重时更宽容（可能多个候选框住同一个角标）
 */
function detectFinderPatterns(
  binary: Uint8Array,
  width: number,
  height: number,
  regionOfInterest: { minX: number; minY: number; maxX: number; maxY: number } | null
): FinderCandidate[] {
  const candidates: FinderCandidate[] = [];
  const { minX, minY, maxX, maxY } = regionOfInterest || { minX: 0, minY: 0, maxX: width, maxY: height };
  const regionSize = Math.max(maxX - minX, maxY - minY);
  const minModule = Math.max(3, Math.floor(regionSize / 120));
  const step = Math.max(2, Math.floor(minModule / 2));
  let scannedRows = 0, scannedPatterns = 0, rejectedByVertical = 0;

  for (let y = minY + step; y < maxY - step; y += step) {
    scannedRows++;
    let x = minX;
    while (x < maxX - step) {
      const horizontal = scanOneLine(binary, width, x, y, maxX);
      if (horizontal) {
        x = horizontal.endX;
        scannedPatterns++;
        const vertical = scanOneColumn(binary, width, height, horizontal.centerX, y, minY, maxY);
        // 放宽垂直方向 size 差容忍到 0.5（之前是 0.3）
        if (vertical && Math.abs(horizontal.size - vertical.size) < Math.max(horizontal.size, vertical.size) * 0.5) {
          const candidate: FinderCandidate = {
            center: { x: horizontal.centerX, y: vertical.centerY },
            size: (horizontal.size + vertical.size) / 2,
            score: horizontal.score + vertical.score,
          };
          const dup = candidates.find(
            (c) => Math.abs(c.center.x - candidate.center.x) < candidate.size &&
                   Math.abs(c.center.y - candidate.center.y) < candidate.size
          );
          if (dup) {
            dup.center.x = (dup.center.x + candidate.center.x) / 2;
            dup.center.y = (dup.center.y + candidate.center.y) / 2;
            dup.size = (dup.size + candidate.size) / 2;
            dup.score += candidate.score;
          } else {
            candidates.push(candidate);
          }
        } else { rejectedByVertical++; }
      } else { x++; }
    }
  }

  info(`[Step 3] Finder Pattern: 扫 ${scannedRows} 行, 命中 ${scannedPatterns}, 去重后 ${candidates.length} 个`);
  if (candidates.length === 0) {
    warn(`未找到任何 Finder Pattern —— AI 二维码可能缺少标准角标特征`);
  } else if (candidates.length < 3) {
    warn(`只找到 ${candidates.length} 个 Finder Pattern (< 3)，将退回边缘拟合`);
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
}

// ========== 4. 四边形拟合 ==========

/**
 * 四边形边缘拟合 —— 对 AI 生图：
 * - 多扫描一次，用 "最大梯度变化" 来定位边缘
 * - 允许从多个备选方向（内外）取最优
 */
function fitQuadrilateral(binary: Uint8Array, width: number, height: number, roughRegion: Point[]): Point[] {
  const x0 = Math.max(0, Math.floor(Math.min(...roughRegion.map((p) => p.x))) - 8);
  const y0 = Math.max(0, Math.floor(Math.min(...roughRegion.map((p) => p.y))) - 8);
  const x1 = Math.min(width, Math.ceil(Math.max(...roughRegion.map((p) => p.x))) + 8);
  const y1 = Math.min(height, Math.ceil(Math.max(...roughRegion.map((p) => p.y))) + 8);

  // 左边缘：从 x0 向中心扫描，统计每行的第一个 "从白到黑" 的 x
  let bestLeftX = x0, leftGrad = 0;
  for (let x = x0; x < (x0 + x1) / 2; x++) {
    let g = 0;
    for (let y = y0; y < y1; y += 2) g += Math.abs(binary[y * width + x] - binary[y * width + Math.max(x0, x - 1)]);
    if (g > leftGrad) { leftGrad = g; bestLeftX = x; }
  }

  let bestRightX = x1, rightGrad = 0;
  for (let x = x1; x > (x0 + x1) / 2; x--) {
    let g = 0;
    for (let y = y0; y < y1; y += 2) g += Math.abs(binary[y * width + x] - binary[y * width + Math.min(x1, x + 1)]);
    if (g > rightGrad) { rightGrad = g; bestRightX = x; }
  }

  let bestTopY = y0, topGrad = 0;
  for (let y = y0; y < (y0 + y1) / 2; y++) {
    let g = 0;
    for (let x = x0; x < x1; x += 2) g += Math.abs(binary[y * width + x] - binary[Math.max(y0, y - 1) * width + x]);
    if (g > topGrad) { topGrad = g; bestTopY = y; }
  }

  let bestBottomY = y1, bottomGrad = 0;
  for (let y = y1; y > (y0 + y1) / 2; y--) {
    let g = 0;
    for (let x = x0; x < x1; x += 2) g += Math.abs(binary[y * width + x] - binary[Math.min(y1, y + 1) * width + x]);
    if (g > bottomGrad) { bottomGrad = g; bestBottomY = y; }
  }

  info(`[Step 4] 四边形拟合: 左=${bestLeftX}, 右=${bestRightX}, 上=${bestTopY}, 下=${bestBottomY}`);
  if (leftGrad === 0 || rightGrad === 0 || topGrad === 0 || bottomGrad === 0) {
    warn(`部分方向边缘不清晰，拟合可能不准`);
  }

  return [
    { x: bestLeftX, y: bestTopY },
    { x: bestRightX, y: bestTopY },
    { x: bestRightX, y: bestBottomY },
    { x: bestLeftX, y: bestBottomY }
  ];
}

// ========== 5. Timing Pattern 精修 ==========

function findEdgeAlongLine(binary: Uint8Array, width: number, height: number, from: Point, to: Point): Point | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 5) return null;
  const ux = dx / len, uy = dy / len;
  const searchLen = Math.min(len * 0.4, 80); // 搜索更深
  let maxGrad = 0, bestT = 0;
  for (let t = 3; t < searchLen; t += 2) {
    const x = Math.round(from.x + ux * t), y = Math.round(from.y + uy * t);
    if (x < 0 || x >= width || y < 0 || y >= height) break;
    const x1 = Math.min(width - 1, x + 4), x0 = Math.max(0, x - 4);
    const y1 = Math.min(height - 1, y + 4), y2 = Math.max(0, y - 4);
    const gradX = Math.abs(binary[y * width + x1] - binary[y * width + x0]);
    const gradY = Math.abs(binary[y1 * width + x] - binary[y2 * width + x]);
    const grad = gradX + gradY;
    if (grad > maxGrad) { maxGrad = grad; bestT = t; }
  }
  if (maxGrad < 1) return null;
  return { x: from.x + ux * bestT, y: from.y + uy * bestT };
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point {
  const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(denom) < 1e-6) return p1;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
  return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y) };
}

function searchBestEdge(binary: Uint8Array, width: number, height: number, corner: Point, pointA: Point, pointB: Point): Point | null {
  const edge1 = findEdgeAlongLine(binary, width, height, corner, pointA);
  const edge2 = findEdgeAlongLine(binary, width, height, corner, pointB);
  if (edge1 && edge2) return lineIntersection(corner, edge1, corner, edge2);
  return null;
}

function refineCornersByTiming(binary: Uint8Array, width: number, height: number, roughCorners: Point[]): Point[] {
  info(`[Step 5] Timing Pattern 精修 4 个角点`);
  return roughCorners.map((corner, idx) => {
    const prev = roughCorners[(idx + 3) % 4];
    const next = roughCorners[(idx + 1) % 4];
    const r = searchBestEdge(binary, width, height, corner, prev, next);
    const newCorner = r || corner;
    const delta = Math.round(Math.sqrt((newCorner.x - corner.x) ** 2 + (newCorner.y - corner.y) ** 2));
    info(`  #${idx + 1}: (${Math.round(corner.x)},${Math.round(corner.y)}) → (${Math.round(newCorner.x)},${Math.round(newCorner.y)}), 偏移=${delta}px`);
    return newCorner;
  });
}

// ========== 6. Finder Pattern → 角点坐标推断 ==========

function dist(a: Point, b: Point): number { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

function determineCornersFromFinderPatterns(fps: FinderCandidate[], width: number, height: number, binary: Uint8Array): QRCodeCorners | null {
  const [A, B, C] = fps;
  const dAB = dist(A.center, B.center);
  const dBC = dist(B.center, C.center);
  const dAC = dist(A.center, C.center);
  const maxDist = Math.max(dAB, dBC, dAC);

  // 对角线两端的两个 Finder Pattern 距离最大，中间那个就是 topLeft
  let tlCenter: Point, o1: Point, o2: Point;
  if (maxDist === dAB) { tlCenter = C.center; o1 = A.center; o2 = B.center; }
  else if (maxDist === dBC) { tlCenter = A.center; o1 = B.center; o2 = C.center; }
  else { tlCenter = B.center; o1 = A.center; o2 = C.center; }

  // 根据 x 坐标区分 TR 和 BL（TL 已确定，且 TR 偏右，BL 偏下）
  let trCenter: Point, blCenter: Point;
  if (o1.x > o2.x) { trCenter = o1; blCenter = o2; }
  else { trCenter = o2; blCenter = o1; }

  // 用平行四边形公式推断右下角
  const br = { x: trCenter.x + blCenter.x - tlCenter.x, y: trCenter.y + blCenter.y - tlCenter.y };
  const rough: Point[] = [tlCenter, trCenter, br, blCenter];
  const refined = refineCornersByTiming(binary, width, height, rough);
  return orderCorners(refined);
}

// ========== 7. 角点排序 / 最终结果输出 ==========

/**
 * 统一使用 perspectiveUtils.normalizeCorners：
 * 去重 → 质心极角排序 → 叉积判定顺时针 → y 最小作为 TL
 * 输出顺序固定：TL → TR → BR → BL
 */
function orderCorners(points: Point[]): QRCodeCorners {
  const ordered = normalizeCorners(points);
  return {
    topLeft: ordered[0],
    topRight: ordered[1],
    bottomRight: ordered[2],
    bottomLeft: ordered[3]
  };
}

function logFinalResult(result: QRCodeCorners | null): void {
  if (!result) {
    warn(`最终角点为 NULL`);
    return;
  }
  const { topLeft, topRight, bottomLeft, bottomRight } = result;
  const wTop = dist(topLeft, topRight), wBot = dist(bottomLeft, bottomRight);
  const hLeft = dist(topLeft, bottomLeft), hRight = dist(topRight, bottomRight);
  const w = (wTop + wBot) / 2, h = (hLeft + hRight) / 2;

  console.log(
    `[QRDetector] 角点: TL(${Math.round(topLeft.x)},${Math.round(topLeft.y)}) ` +
    `TR(${Math.round(topRight.x)},${Math.round(topRight.y)}) ` +
    `BR(${Math.round(bottomRight.x)},${Math.round(bottomRight.y)}) ` +
    `BL(${Math.round(bottomLeft.x)},${Math.round(bottomLeft.y)}) ` +
    `| 尺寸 ${Math.round(w)}×${Math.round(h)}px, 宽高比 ${(w / h).toFixed(3)}`
  );
}

// ========== 主入口 ==========

/**
 * 基于图像特征的二维码角点检测（专门针对 AI 生成的 "无效二维码" 图片）
 * 流程：Otsu 二值化 → 密度热力图 → Finder Pattern 检测 → 四边形拟合 → Timing Pattern 精修
 */
export function detectQRCornersByImageFeatures(canvas: HTMLCanvasElement): QRCodeCorners | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    warn(`无法获取 canvas 2D context`);
    return null;
  }
  const width = canvas.width, height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  console.log(`[QRDetector] 开始图像特征检测: ${width}×${height}`);

  // Step 1: Otsu 二值化
  const threshold = otsuThreshold(imageData.data, width, height);
  const binary = binarize(imageData.data, width, height, threshold);

  // Step 2: 网格密度热力图（cellSize 更小，对模糊二维码更敏感）
  const cellSize = Math.max(5, Math.floor(Math.min(width, height) / 150));
  const { density, gridW, gridH } = computeModuleDensityMap(binary, width, height, cellSize);
  const regionResult = findQRRegionFromDensity(density, gridW, gridH, cellSize, width, height);

  if (!regionResult) {
    warn(`无法从密度图找到高纹理区域 → 用画布中央区域估计`);
    const cx = width / 2, cy = height / 2, half = Math.min(width, height) * 0.25;
    const roughCorners: Point[] = [
      { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
      { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half }
    ];
    const refined = refineCornersByTiming(binary, width, height, roughCorners);
    const result = orderCorners(refined);
    logFinalResult(result);
    return result;
  }

  // Step 3: Finder Pattern 检测
  const roi = {
    minX: Math.floor(Math.min(...regionResult.corners.map((p) => p.x))),
    minY: Math.floor(Math.min(...regionResult.corners.map((p) => p.y))),
    maxX: Math.ceil(Math.max(...regionResult.corners.map((p) => p.x))),
    maxY: Math.ceil(Math.max(...regionResult.corners.map((p) => p.y))),
  };
  const fps = detectFinderPatterns(binary, width, height, roi);

  if (fps.length >= 3) {
    info(`  ✓ 找到 ≥3 个 Finder Pattern → 用 FP 推断 4 个角点`);
    const result = determineCornersFromFinderPatterns(fps.slice(0, 3), width, height, binary);
    logFinalResult(result);
    return result;
  }

  info(`  ✗ FP 不足 3 个 (只有 ${fps.length}) → 退回四边形边缘拟合`);

  // Step 4: 四边形边缘拟合
  const fitted = fitQuadrilateral(binary, width, height, regionResult.corners);

  // Step 5: Timing Pattern 精修
  const refined = refineCornersByTiming(binary, width, height, fitted);
  const result = orderCorners(refined);
  logFinalResult(result);
  return result;
}

// 保留原有接口名兼容 (getLuminance 被外部引用)
export { getLuminance };
