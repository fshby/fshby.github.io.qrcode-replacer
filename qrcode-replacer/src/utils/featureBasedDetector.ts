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
 * 判断是否是"微信支付码绿"或其它鲜艳背景色：
 *   G >> R 且 G >> B，同时整体亮度不极端 → 这种像素会干扰 Otsu，
 *   在二值化阶段应强制当作"纯白背景"处理，让真正的二维码黑白对比度能浮现。
 * 返回：true = 当作白色背景（255）
 */
function isColoredBackground(r: number, g: number, b: number): boolean {
  // 绿/蓝/红的"单色背景"都按这个规则过滤：最大通道比最小通道高出 50 以上，且最大通道 >= 120
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  if (maxC - minC < 50) return false;
  if (maxC < 120) return false;
  // 同时亮度不能过低（避免深色背景被误判）
  const lum = (r + g + b) / 3;
  return lum > 80;
}

/**
 * Otsu 阈值二值化：
 *   - 对彩色背景（微信支付码绿底等）先做一次"彩色像素→白"，让 Otsu 只在真正的
 *     "黑/白二维码区域"计算阈值
 */
function otsuThreshold(data: Uint8ClampedArray, width: number, height: number): number {
  const histogram = new Uint32Array(256);
  const pixelCount = width * height;

  let minLum = 255, maxLum = 0;
  let coloredPixels = 0;
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    let lum: number;
    if (isColoredBackground(r, g, b)) {
      // 彩色背景 → 视作白背景 (255)，不进入阈值计算
      lum = 255;
      coloredPixels++;
    } else {
      lum = Math.round((r + g + b) / 3);
    }
    histogram[lum]++;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

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
  info(`[Step 1] 二值化: ${width}×${height}, 阈值=${threshold}, 前景=${(fgRatio * 100).toFixed(1)}%, 彩色背景像素=${(coloredPixels / pixelCount * 100).toFixed(1)}%`);
  if (fgRatio < 0.03 || fgRatio > 0.97) {
    warn(`前景比例异常 (${(fgRatio * 100).toFixed(1)}%)，可能不像二维码`);
  }
  return threshold;
}

/**
 * 生成二值图像并统计纹理密度
 */
function binarize(data: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8Array {
  const result = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    const lum = isColoredBackground(r, g, b) ? 255 : (r + g + b) / 3;
    result[i] = lum < threshold ? 1 : 0;
  }
  return result;
}

// ========== 2. 网格密度热力图（多尺度） ==========

/**
 * 多尺度密度图：同时按 3 种 cellSize 计算密度图，并取每个格子的最高得分
 * 解决：大图中二维码区域的密度被低估的问题
 */
function computeModuleDensityMap(
  binary: Uint8Array,
  width: number,
  height: number,
  cellSize: number
): { density: Float32Array; gridW: number; gridH: number } {
  // 同时在 3 个尺度计算密度，取各尺度的最大值（更鲁棒）
  const half = Math.max(5, Math.floor(cellSize * 0.5));
  const one5 = Math.floor(cellSize * 1.5);
  const rawSizes = [half, cellSize, one5];
  const cellSizes = Array.from(new Set(rawSizes));

  // 使用最大的 cellSize 作为最终的网格尺寸（与原来一致）
  const baseCell = Math.max(...cellSizes);
  const gridW = Math.ceil(width / baseCell);
  const gridH = Math.ceil(height / baseCell);
  const density = new Float32Array(gridW * gridH);
  let maxLocalDensity = 0;

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = gx * baseCell;
      const y0 = gy * baseCell;
      const x1 = Math.min(x0 + baseCell, width);
      const y1 = Math.min(y0 + baseCell, height);

      // 在这个单元格内，对每个小尺度计算密度，取最大
      let bestScore = 0;
      for (const cs of cellSizes) {
        if (cs > (x1 - x0) || cs > (y1 - y0)) continue;
        let hTransitions = 0, vTransitions = 0;
        // 步长 = max(1, cs / 6)，保证有足够采样
        const step = Math.max(1, Math.floor(cs / 8));
        for (let y = y0; y < y1; y += step) {
          let rowPrev: number | null = null;
          for (let x = x0; x < x1; x += step) {
            const v = binary[y * width + x];
            if (rowPrev !== null && v !== rowPrev) hTransitions++;
            rowPrev = v;
          }
        }
        for (let x = x0; x < x1; x += step) {
          let colPrev: number | null = null;
          for (let y = y0; y < y1; y += step) {
            const v = binary[y * width + x];
            if (colPrev !== null && v !== colPrev) vTransitions++;
            colPrev = v;
          }
        }
        const sampledW = Math.floor((x1 - x0) / step);
        const sampledH = Math.floor((y1 - y0) / step);
        const sampledCells = Math.max(1, sampledW) * Math.max(1, sampledH);
        const totalTransitions = hTransitions + vTransitions;
        const balancedBonus = Math.min(hTransitions, vTransitions) / Math.max(1, Math.max(hTransitions, vTransitions));
        const score = Math.min(100, (totalTransitions / sampledCells) * 100 * (0.5 + balancedBonus));
        if (score > bestScore) bestScore = score;
      }
      density[gy * gridW + gx] = bestScore;
      if (bestScore > maxLocalDensity) maxLocalDensity = bestScore;
    }
  }

  info(`[Step 2] 密度热力图 (多尺度 cellSizes=[${cellSizes.join(',')}]: ${gridW}×${gridH}, 峰值=${maxLocalDensity.toFixed(1)}`);
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
  const total = density.length;
  const sorted = [...density].sort((a, b) => b - a);
  const topCount = Math.max(1, Math.floor(total * 0.05));
  let topSum = 0;
  for (let i = 0; i < topCount; i++) topSum += sorted[i];
  const topAvg = topSum / topCount;
  const topMax = sorted[0];
  info(`  前 ${(topCount / total * 100).toFixed(1)}% 高分格子: 峰值=${topMax.toFixed(1)}, 均值=${topAvg.toFixed(1)}`);

  // 密度图主阈值：按 topMax 的 30% 自适应；二维码区域通常密度 40-100，白卡片/绿背景 < 10
  // 最低阈值保持 6，避免纯噪声图全选
  const threshold = Math.max(topMax * 0.30, 6);
  info(`  密度阈值: ${threshold.toFixed(1)} (topMax=${topMax.toFixed(1)})`);

  if (topMax < 8) {
    // 整张图几乎没有高密度区域 → 可能确实不是二维码图
    warn(`密度太低 (topMax=${topMax.toFixed(1)})，图像太平滑`);
    return null;
  }

  const highDensityCount = density.filter((d) => d >= threshold).length;
  info(`  高纹理格子数: ${highDensityCount} (${(highDensityCount / total * 100).toFixed(1)}%)`);

  const regionMap = new Uint8Array(gridW * gridH);
  for (let i = 0; i < density.length; i++) regionMap[i] = density[i] >= threshold ? 1 : 0;

  const labels = new Int32Array(gridW * gridH);
  const regions: {
    minX: number; minY: number; maxX: number; maxY: number;
    count: number; score: number; totalDensity: number; avgDensity: number;
  }[] = [];
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
        const avgDensity = densitySum / count;
        // 最小面积：二维码至少占 5 格（cellSize≈5 时 ≈ 25×25 像素），
        // 同时不超过整张图的 70%（避免把整张图所有高纹理区域都囊括）
        const minCells = Math.max(5, Math.floor(total * 0.002));
        const maxCells = Math.floor(total * 0.7);
        const areaOK = count >= minCells && count <= maxCells;
        // bounding box 的宽高都要够大（避免细长文字）
        const boxOK = wCells >= 3 && hCells >= 3;

        // ---- 综合评分：正方形偏好、密度、面积、密度均匀性
        const boxW = maxX - minX + 1, boxH = maxY - minY + 1;
        const ratio = Math.max(boxW, boxH) / Math.max(1, Math.min(boxW, boxH));
        const squareBonus = Math.max(0, 1 - (ratio - 1) * 1.2); // ratio=1.0→1, ratio=1.8→0.04

        const areaBonus = count > 16 ? Math.min(1, count / 100) : 0.1;

        // 密度均匀性：检查区域的 3×3 九宫格采样，看各子格的密度方差
        const subCount = 3;
        const subW = Math.ceil(boxW / subCount), subH = Math.ceil(boxH / subCount);
        let subMin2 = Infinity, subMax2 = -Infinity;
        for (let sy = 0; sy < subCount; sy++) {
          for (let sx = 0; sx < subCount; sx++) {
            const cx = minX + sx * subW, cy = minY + sy * subH;
            let localDensity = 0, localCells = 0;
            for (let dy = 0; dy < subH; dy++) {
              for (let dx = 0; dx < subW; dx++) {
                const gx = cx + dx, gy = cy + dy;
                if (gx >= gridW || gy >= gridH) continue;
                const idx = gy * gridW + gx;
                if (labels[idx] !== labelCount) continue;
                localDensity += density[idx];
                localCells++;
              }
            }
            if (localCells > 0) {
              const avg = localDensity / localCells;
              if (avg < subMin2) subMin2 = avg;
              if (avg > subMax2) subMax2 = avg;
            }
          }
        }
        const uniformityBonus = subMax2 > 0 ? Math.max(0, 1 - (subMax2 - subMin2) / (subMax2 + 10)) : 0;

        const composite =
          squareBonus * 0.40 +             // 正方形优先：40% 权重
          (avgDensity / 100) * 0.25 +     // 高密度：25%
          areaBonus * 0.20 +               // 适当面积：20%
          uniformityBonus * 0.15;          // 均匀：15%

        regions.push({
          minX, minY, maxX, maxY, count,
          totalDensity: densitySum,
          avgDensity,
          score: areaOK && boxOK ? composite : -1
        });
      }
    }
  }

  info(`  连通区域数: ${regions.length} 个 (通过面积/宽高比过滤前)`);
  const validRegions = regions.filter(r => r.score > 0);
  info(`  通过过滤的区域: ${validRegions.length} 个`);
  if (validRegions.length === 0) {
    info(`  密度热力图没能找到合理的二维码形状区域 → 返回 null，交给后续 FP 检测兜底`);
    return null;
  }

  // 选综合得分最高的（不再只看面积）
  validRegions.sort((a, b) => b.score - a.score);
  const best = validRegions[0];
  // 扩展 padding：让后续 FP 检测能覆盖 QR 外侧白边（Finder Pattern 到真实 QR 边约 1 模块）
  const pad = 2;
  const x0 = Math.max(0, (best.minX - pad) * cellSize);
  const y0 = Math.max(0, (best.minY - pad) * cellSize);
  const x1 = Math.min(imageW, (best.maxX + 1 + pad) * cellSize);
  const y1 = Math.min(imageH, (best.maxY + 1 + pad) * cellSize);

  const corners: Point[] = [
    { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }
  ];

  const regionRatio = best.count / (gridW * gridH);
  const confidence = Math.min(100, regionRatio * 300 + best.score * 10);
  info(`  → 选中 ROI: (${x0},${y0})-(${x1},${y1}), 面积格子=${best.count}, 置信度=${confidence.toFixed(1)}`);

  return { corners, confidence };
}

// ========== 2b. 白色边框检测（针对伪二维码，重点增强）==========

/**
 * 检测伪二维码的白色边框 — 使用原始 RGB 做精细检测：
 *   纹理区（二维码黑白模块，亮度跳变频繁）
 *   白边区（纯白，R≈G≈B≈255）
 *   背景区（名片灰色或彩色，非纯白）
 *
 * 核心思路：
 *   1. 用密度图中心作为出发点
 *   2. 四向扫描原始 RGB 像素
 *   3. 找到 "纹理区 → 白边区 → 背景区" 的过渡
 *   4. 白边区的内边缘就是二维码的真实四角
 *
 * @param rawData  原始 ImageData.data（未经二值化）
 * @param binary   Otsu 二值化结果（用于纹理判断）
 */
function detectWhiteBorderCorners(
  rawData: Uint8ClampedArray,
  _binary: Uint8Array,
  width: number,
  height: number,
  region: { corners: Point[] }
): { corners: Point[]; confidence: number } | null {
  // 1. 计算密度图中心与尺寸
  const xs = region.corners.map(p => p.x), ys = region.corners.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = Math.round((minX + maxX) / 2);
  const cy = Math.round((minY + maxY) / 2);
  const rw = maxX - minX;
  const rh = maxY - minY;

  info(`[Step 2b] 白色边框检测: 中心(${cx},${cy}), 密度区 ${Math.round(rw)}×${Math.round(rh)}px`);

  // 2. 工具函数：判断一个像素是否是"白纸白"
  function isPureWhite(x: number, y: number): boolean {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = (y * width + x) * 4;
    const r = rawData[idx], g = rawData[idx + 1], b = rawData[idx + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return maxC > 230 && (maxC - minC) < 25;
  }

  // 3. 小窗口亮度跳变数（判断是否是二维码纹理区）
  const halfWin = Math.max(3, Math.floor(Math.min(rw, rh) * 0.04));
  function textureScore(x: number, y: number): number {
    let transitions = 0, prevLum: number | null = null;
    for (let dy = -halfWin; dy <= halfWin; dy += 2) {
      for (let dx = -halfWin; dx <= halfWin; dx += 2) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const idx = (ny * width + nx) * 4;
        const lum = (rawData[idx] + rawData[idx + 1] + rawData[idx + 2]) / 3;
        if (prevLum !== null && Math.abs(lum - prevLum) > 60) transitions++;
        prevLum = lum;
      }
    }
    return transitions;
  }

  // 4. 核心扫描 — 必须先"穿过纹理区"再遇到"白边"，才认为白边有效
  //    关键修复：密度图中心可能本身就在白模块/白边附近，需要走一段纹理区再找白边
  const textureThreshold = 3;
  const textureMinRun = Math.max(3, Math.floor(Math.min(rw, rh) * 0.05));  // 至少连续 N 像素是纹理
  const whiteMinRun = 2;  // 连续白边才认为进入真正白边
  const maxStep = Math.floor(Math.max(width, height) * 0.3);

  function findBorder(
    startX: number, startY: number,
    dx: number, dy: number
  ): { borderPos: number; ok: boolean } {
    // 状态机: 'pre-texture' → 'in-texture' → 'in-white' → 'past-white'
    let state: 'pre-texture' | 'in-texture' | 'in-white' | 'past-white' = 'pre-texture';
    let textureRun = 0;
    let whiteRun = 0;
    let whiteEnterStep = -1;

    for (let step = 0; step < maxStep; step++) {
      const x = startX + dx * step;
      const y = startY + dy * step;
      if (x < 0 || x >= width || y < 0 || y >= height) break;

      const white = isPureWhite(x, y);
      const texture = textureScore(x, y) >= textureThreshold;

      if (state === 'pre-texture') {
        // 必须先穿过一段纹理区，确认当前位置已经在二维码内部
        if (texture) {
          textureRun++;
          if (textureRun >= textureMinRun) state = 'in-texture';
        } else if (white) {
          textureRun = 0;  // 白像素不算纹理，但也不是噪声干扰
        } else {
          textureRun = Math.max(0, textureRun - 1);  // 非纹理/非白 → 缓慢衰减
        }
      } else if (state === 'in-texture') {
        // 现在在二维码纹理区，等遇到连续的白纸白
        if (white) {
          whiteRun++;
          if (whiteRun >= whiteMinRun) {
            state = 'in-white';
            whiteEnterStep = step - whiteMinRun + 1;  // 白边起始位置（保守估计）
          }
        } else {
          whiteRun = 0;  // 还在纹理内部
        }
      } else if (state === 'in-white') {
        // 当前在白边里，等走出去（或走到图像边缘）
        if (!white) {
          state = 'past-white';
          return { borderPos: whiteEnterStep, ok: true };
        }
      }
    }

    // 走到图像边缘还在白边中（二维码贴着图像边缘，比较少见）
    if (state === 'in-white' && whiteEnterStep > 0) {
      return { borderPos: whiteEnterStep, ok: true };
    }
    return { borderPos: -1, ok: false };
  }

  const leftR = findBorder(cx, cy, -1, 0);
  const rightR = findBorder(cx, cy, 1, 0);
  const topR = findBorder(cx, cy, 0, -1);
  const bottomR = findBorder(cx, cy, 0, 1);

  const xL = cx - leftR.borderPos;
  const xR = cx + rightR.borderPos;
  const yT = cy - topR.borderPos;
  const yB = cy + bottomR.borderPos;
  const allOk = leftR.ok && rightR.ok && topR.ok && bottomR.ok;

  info(`  四向结果: L=${xL}(${leftR.ok ? 'OK' : 'NG'}), R=${xR}(${rightR.ok ? 'OK' : 'NG'}), ` +
       `T=${yT}(${topR.ok ? 'OK' : 'NG'}), B=${yB}(${bottomR.ok ? 'OK' : 'NG'})`);

  // 5. 白边矩形尺寸 + 合理性校验（关键修复：放宽尺寸约束）
  const bw = xR - xL;
  const bh = yB - yT;
  info(`  → 白边矩形: ${Math.round(bw)}×${Math.round(bh)}px`);

  if (!allOk) {
    warn(`  白边检测: 有方向未找到边界`);
    return null;
  }
  const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
  if (aspect > 2.5) {
    warn(`  白边检测: 宽高比 ${aspect.toFixed(2)} 太离谱`);
    return null;
  }
  // 关键修复：不跟密度图区比大小，只要求白边矩形本身足够大
  const minDim = Math.max(20, Math.floor(Math.min(rw, rh) * 0.4));
  if (bw < minDim || bh < minDim) {
    warn(`  白边检测: 尺寸 ${Math.round(bw)}×${Math.round(bh)} 太小（阈值≈${minDim}）`);
    return null;
  }
  if (xL <= 2 || yT <= 2 || xR >= width - 2 || yB >= height - 2) {
    warn(`  白边检测: 边界触到图像边缘`);
    return null;
  }

  const confidence = Math.max(0, 1 - (aspect - 1) * 2) * 100;

  // 轻微内缩（3%）让角点贴近二维码
  const shrinkX = Math.max(2, Math.round(bw * 0.03));
  const shrinkY = Math.max(2, Math.round(bh * 0.03));
  return {
    corners: [
      { x: xL + shrinkX, y: yT + shrinkY },
      { x: xR - shrinkX, y: yT + shrinkY },
      { x: xR - shrinkX, y: yB - shrinkY },
      { x: xL + shrinkX, y: yB - shrinkY }
    ],
    confidence
  };
}

// 保留原 detectCardCorners 作为回退方案（二值化 + 四向扫描）
function detectCardCorners(
  binary: Uint8Array,
  width: number,
  height: number,
  region: { corners: Point[] }
): Point[] | null {
  const xs = region.corners.map(p => p.x), ys = region.corners.map(p => p.y);
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  const rw = Math.max(...xs) - Math.min(...xs);
  const rh = Math.max(...ys) - Math.min(...ys);
  const minRun = Math.max(5, Math.floor(Math.min(rw, rh) * 0.02));

  let whiteCount = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && x < width && y >= 0 && y < height) {
        if (binary[y * width + x] === 0) whiteCount++;
      }
    }
  }
  const cardWhite = whiteCount > 25 ? 0 : 1;

  function scan(x: number, y: number, dx: number, dy: number): number {
    let run = 0, step = 0;
    while (x >= 0 && y >= 0 && x < width && y < height) {
      const val = binary[y * width + x];
      if (val === cardWhite) run = 0;
      else run++;
      if (run >= minRun) return step - minRun;
      x += dx; y += dy; step++;
    }
    return step;
  }

  const left = Math.max(0, cx - scan(cx, cy, -1, 0));
  const right = Math.min(width - 1, cx + scan(cx, cy, 1, 0));
  const top = Math.max(0, cy - scan(cx, cy, 0, -1));
  const bottom = Math.min(height - 1, cy + scan(cx, cy, 0, 1));
  const cardW = right - left, cardH = bottom - top;

  if (cardW < rw * 0.8 || cardH < rh * 0.8) return null;
  if (left === 0 || top === 0 || right === width - 1 || bottom === height - 1) return null;
  if (cardW * cardH > rw * rh * 4) return null;

  const sx = Math.round(cardW * 0.05), sy = Math.round(cardH * 0.05);
  return [
    { x: left + sx, y: top + sy },
    { x: right - sx, y: top + sy },
    { x: right - sx, y: bottom - sy },
    { x: left + sx, y: bottom - sy }
  ];
}

// ========== 3. Finder Pattern 检测 ==========

interface FinderCandidate { center: Point; size: number; score: number; }

/**
 * 扫一条水平线，找 1:1:3:1:1 比例的 Finder Pattern
 */
function scanOneLine(binary: Uint8Array, width: number, startX: number, y: number, maxX: number): { centerX: number; size: number; score: number; endX: number } | null {
  let x = startX;
  while (x < maxX && binary[y * width + x] === 0) x++;
  if (x >= maxX) return null;
  const segments: number[] = [];
  let currentColor = binary[y * width + x];
  const firstSegStart = x;
  let segStart = x;
  for (; x < maxX && segments.length < 5; x++) {
    const v = binary[y * width + x];
    if (v !== currentColor) { segments.push(x - segStart); currentColor = v; segStart = x; }
  }
  if (segments.length < 5) return null;
  const [s1, s2, s3, s4, s5] = segments;
  const total = s1 + s2 + s3 + s4 + s5;
  if (total < 7) return null; // 理论最小值：1:1:3:1:1 = 7
  const unit = total / 7;
  const tolerance = unit * 0.75; // AI 模糊容忍度调高
  if (Math.abs(s1 - unit) < tolerance && Math.abs(s2 - unit) < tolerance &&
      Math.abs(s3 - unit * 3) < tolerance * 1.8 &&
      Math.abs(s4 - unit) < tolerance && Math.abs(s5 - unit) < tolerance &&
      s1 >= 1 && s5 >= 1 && s3 >= 2) {
    // 中心点 = 第一段起点 + s1 + s2 + s3 / 2
    const centerX = firstSegStart + s1 + s2 + s3 / 2;
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
  const firstSegStart = yy;
  let segStart = yy;
  for (; yy < maxY && segments.length < 5; yy++) {
    const v = binary[yy * width + x];
    if (v !== currentColor) { segments.push(yy - segStart); currentColor = v; segStart = yy; }
  }
  if (segments.length < 5) return null;
  const [s1, s2, s3, s4, s5] = segments;
  const total = s1 + s2 + s3 + s4 + s5;
  if (total < 7) return null;
  const unit = total / 7;
  const tolerance = unit * 0.75;
  if (Math.abs(s1 - unit) < tolerance && Math.abs(s2 - unit) < tolerance &&
      Math.abs(s3 - unit * 3) < tolerance * 1.8 &&
      Math.abs(s4 - unit) < tolerance && Math.abs(s5 - unit) < tolerance) {
    const centerY = firstSegStart + s1 + s2 + s3 / 2;
    return { centerY, size: total, score: 10 };
  }
  return null;
}

/**
 * Finder Pattern 检测
 * 关键修复：
 * 1. minModule 改为 max(2, floor(regionSize / 250))，在大图/小二维码时不会太大
 * 2. step 改为 max(1, floor(minModule / 2))，保证细扫描
 * 3. scanOneLine 的 total 阈值降到 7（小二维码上，1:1:3:1:1 每段 1~2 像素都是合理的）
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
  const minModule = Math.max(2, Math.floor(regionSize / 250)); // 原图 120 太粗，放宽到 250
  const step = Math.max(1, Math.floor(minModule / 2));
  let scannedRows = 0, scannedPatterns = 0, rejectedByVertical = 0;

  for (let y = minY + step; y < maxY - step; y += step) {
    scannedRows++;
    let x = minX;
    while (x < maxX - step) {
      const horizontal = scanOneLine(binary, width, x, y, maxX);
      if (horizontal) {
        x = horizontal.endX;
        scannedPatterns++;
        const vertical = scanOneColumn(binary, width, height, Math.round(horizontal.centerX), y, minY, maxY);
        // 放宽垂直方向 size 差容忍到 0.5（之前是 0.3）
        if (vertical && Math.abs(horizontal.size - vertical.size) < Math.max(horizontal.size, vertical.size) * 0.6) {
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
  // 以 from 为中心双向搜索：向外 5%（跨过二维码边缘）、向内 40%（二维码内部）
  // 这样避免在二维码内部的首个黑白交界处（比如 Finder Pattern 的内层）被误判为边
  const outT = -Math.min(len * 0.05, 20);
  const inT = Math.min(len * 0.5, 80);
  let maxGrad = 0, bestT = 0;
  for (let t = outT; t < inT; t += 2) {
    const x = Math.round(from.x + ux * t), y = Math.round(from.y + uy * t);
    if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) continue;
    const x1 = x + 3, x0 = x - 3;
    const y1 = y + 3, y2 = y - 3;
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

function determineCornersFromFinderPatterns(fps: FinderCandidate[], width: number, height: number, _binary: Uint8Array): QRCodeCorners | null {
  // 选 top N 候选进行组合枚举；组合数 C(n,3) 对 n=8 仅 56，性能可接受
  const topN = Math.min(fps.length, 8);
  if (topN < 3) return null;
  const top = fps.slice(0, topN);

  // 评分：
  // 1) 两条短边等长 (equalness)
  // 2) 长边 ≈ 短边*√2 (ratioScore)
  // 3) 勾股定理验证 (pyScore)
  // 4) 直角顶点两向量正交 (dotScore)
  // 5) FP 强度 (strength)
  // 6) 尺寸合理性 (排除极小/极大 QR)
  let bestTriple: { a: FinderCandidate; b: FinderCandidate; c: FinderCandidate; score: number; qrSize: number } | null = null;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      for (let k = j + 1; k < top.length; k++) {
        const a = top[i], b = top[j], c = top[k];
        const d1 = dist(a.center, b.center);
        const d2 = dist(b.center, c.center);
        const d3 = dist(a.center, c.center);
        if (d1 < 20 || d2 < 20 || d3 < 20) continue; // 三个点必须分开

        const arr = [d1, d2, d3].sort((p, q) => p - q);
        const shortAvg = (arr[0] + arr[1]) / 2;
        const equalness = 1 - Math.abs(arr[0] - arr[1]) / arr[1];
        const ratio = arr[2] / shortAvg;
        const ratioScore = 1 - Math.min(1, Math.abs(ratio - Math.SQRT2));
        const pythagoras = arr[0] * arr[0] + arr[1] * arr[1];
        const pyErr = Math.abs(pythagoras - arr[2] * arr[2]) / (arr[2] * arr[2]);
        const pyScore = 1 - Math.min(1, pyErr);
        const strength = (a.score + b.score + c.score) / 30;

        // 找到直角顶点：最长边的"所对的那个"顶点
        const pts = [a.center, b.center, c.center];
        let rightIdx = 2;
        if (d1 >= d2 && d1 >= d3) rightIdx = 2; // c 是直角
        else if (d2 >= d1 && d2 >= d3) rightIdx = 0; // a 是直角
        else rightIdx = 1; // b 是直角
        const right = pts[rightIdx];
        const others = pts.filter((_, i) => i !== rightIdx);
        const v1x = others[0].x - right.x, v1y = others[0].y - right.y;
        const v2x = others[1].x - right.x, v2y = others[1].y - right.y;
        const len1 = Math.hypot(v1x, v1y);
        const len2 = Math.hypot(v2x, v2y);
        // 点积 / (|v1|*|v2|)：越接近 0 越接近 90 度
        const dotRaw = (v1x * v2x + v1y * v2y) / Math.max(1e-6, len1 * len2);
        const dotScore = 1 - Math.min(1, Math.abs(dotRaw));
        // QR 尺寸合理性：QR 边长 ≈ 两短边的均值，典型模块大小 = len/29，期望模块大小 8~120 px
        const avgSide = (len1 + len2) / 2;
        const modulePx = avgSide / 29;
        const sizeOk = modulePx > 8 && modulePx < 120;
        const sizeScore = sizeOk ? 1 : 0;

        const score = equalness * 0.2 + ratioScore * 0.25 + pyScore * 0.2 + dotScore * 0.2 + Math.min(1, strength) * 0.05 + sizeScore * 0.1;
        if (!bestTriple || score > bestTriple.score)
          bestTriple = { a, b, c, score, qrSize: avgSide };
      }
    }
  }
  if (!bestTriple || bestTriple.score < 0.5) {
    info(`  Finder Pattern 几何校验失败(score=${bestTriple?.score.toFixed(3)})，退回其它方法`);
    return null;
  }
  info(`  最佳 FP 组合: size=${Math.round(bestTriple.qrSize)}px, score=${bestTriple.score.toFixed(3)}`);

  const { a, b, c } = bestTriple;
  const dAB = dist(a.center, b.center);
  const dBC = dist(b.center, c.center);
  const dAC = dist(a.center, c.center);

  // 最长边两端不是直角顶点；直角 = 剩下那个点。
  let rightIdx = 2;
  if (dAB >= dBC && dAB >= dAC) rightIdx = 2; // c 是直角
  else if (dBC >= dAB && dBC >= dAC) rightIdx = 0; // a 是直角
  else rightIdx = 1; // b 是直角

  const pts2 = [a.center, b.center, c.center];
  const right = pts2[rightIdx];
  const others = pts2.filter((_, i) => i !== rightIdx);

  // 根据直角顶点向量的主方向区分 TR 和 BL
  // 一个应该主要沿水平方向延伸，一个主要沿垂直方向
  // 以主方向是 dx 大的 → TR；另一个 → BL
  let trCenter: Point, blCenter: Point;
  const isHorizontal = (p: Point) => Math.abs(p.x - right.x) > Math.abs(p.y - right.y);
  if (isHorizontal(others[0]) && !isHorizontal(others[1])) {
    trCenter = others[0]; blCenter = others[1];
  } else if (!isHorizontal(others[0]) && isHorizontal(others[1])) {
    trCenter = others[1]; blCenter = others[0];
  } else {
    if (others[0].x > others[1].x) { trCenter = others[0]; blCenter = others[1]; }
    else { trCenter = others[1]; blCenter = others[0]; }
  }

  // ---- 核心改进：用 FP 几何外推 QR 四角，不再做图像 refine ----
  // 新逻辑 (2026-07-04)：不再假设 QR 有固定的 "29 模块"。
  //   - 三个 FP 的像素大小已经由 detectFinderPatterns 测出 (candidate.size)
  //   - FP 中心到 QR 边缘 = FP 大小的一半 (FP 占 7 模块，中心距边缘 3.5 模块)
  //   - TL 中心到 TR 中心的距离 = QR 内部边长 - FP 大小
  //   - 所以 QR 真实边长 ≈ 相邻 FP 中心距 + FP 大小
  const avgFPSize = (a.size + b.size + c.size) / 3;
  const dxTR = trCenter.x - right.x, dyTR = trCenter.y - right.y;   // TL → TR
  const dxBL = blCenter.x - right.x, dyBL = blCenter.y - right.y;   // TL → BL
  const lenTR = Math.hypot(dxTR, dyTR);
  const lenBL = Math.hypot(dxBL, dyBL);

  // 用 FP 自身的像素大小估算 push 距离，不再依赖模块数
  // TL 中心到 TL 边缘 = FP_size/2，这是沿 (TR-TL) 和 (BL-TL) 两个方向的投影
  const push = avgFPSize / 2;

  // TL 真实角点 = TL_FP - push * unit(TL→TR) - push * unit(TL→BL)
  // TR 真实角点 = TR_FP + push * unit(TL→TR) - push * unit(TL→BL)
  // BL 真实角点 = BL_FP - push * unit(TL→TR) + push * unit(TL→BL)
  // BR 真实角点 = TR_real + (BL_real - TL_real)
  const u1x = dxTR / lenTR, u1y = dyTR / lenTR;
  const u2x = dxBL / lenBL, u2y = dyBL / lenBL;

  const tlCorner: Point = { x: right.x - push * u1x - push * u2x, y: right.y - push * u1y - push * u2y };
  const trCorner: Point = { x: trCenter.x + push * u1x - push * u2x, y: trCenter.y + push * u1y - push * u2y };
  const blCorner: Point = { x: blCenter.x - push * u1x + push * u2x, y: blCenter.y - push * u1y + push * u2y };
  const brCorner: Point = { x: trCorner.x + (blCorner.x - tlCorner.x), y: trCorner.y + (blCorner.y - tlCorner.y) };

  info(`  FP 外推: avgFP size=${avgFPSize.toFixed(1)}px, lenTR=${lenTR.toFixed(1)}, lenBL=${lenBL.toFixed(1)}, push=${push.toFixed(1)}`);

  const corners: Point[] = [tlCorner, trCorner, brCorner, blCorner];
  // 夹紧到图像范围
  for (const p of corners) {
    p.x = Math.max(0, Math.min(width - 1, p.x));
    p.y = Math.max(0, Math.min(height - 1, p.y));
  }
  return orderCorners(corners);
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
 * 流程：Otsu 二值化 → 密度热力图 → (ROI 裁剪) → Finder Pattern 检测
 *       → 四边形拟合 → 几何外推 QR 四角
 * 新增 Step 0: 模板匹配 —— 用 public/templates/qr-sample.png 作为样板图，
 *             在大图上搜索"密度分布最像标准二维码"的区域。
 * 注意：不再在内部加黑边；如果需要黑边预处理，请在调用本函数前完成。
 */
export async function detectQRCornersByImageFeatures(canvas: HTMLCanvasElement): Promise<QRCodeCorners | null> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    warn(`无法获取 canvas 2D context`);
    return null;
  }
  const width = canvas.width, height = canvas.height;
  console.log(`[QRDetector] 开始图像特征检测: ${width}×${height}`);

  // Step 1: Otsu 二值化
  const imageData = ctx.getImageData(0, 0, width, height);
  const threshold = otsuThreshold(imageData.data, width, height);
  const binary = binarize(imageData.data, width, height, threshold);

  // Step 2: 网格密度热力图
  const cellSize = Math.max(5, Math.floor(Math.min(width, height) / 150));
  const { density, gridW, gridH } = computeModuleDensityMap(binary, width, height, cellSize);
  const regionResult = findQRRegionFromDensity(density, gridW, gridH, cellSize, width, height);

  // ---------- 检测流程 ----------
  // 记录最佳结果：模板匹配(bonus=3.0) > 密度图(2.3) > FP 检测(2.0) > 卡片(1.8) > 四边形拟合(1.0)
  let bestResult: QRCodeCorners | null = null;
  let bestScore = -Infinity;

  function rateAndRecordTmpl(res: QRCodeCorners, r: number) {
    // r 是 Pearson 相关系数 (-1..1)。r=0.40 → bonus≈3.0；r=0.80 → bonus≈4.6
    const bonus = 2.0 + r * 2.5;
    const w = dist(res.topLeft, res.topRight);
    const h = dist(res.topLeft, res.bottomLeft);
    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
    const aspectScore = 1 / (1 + Math.abs(aspect - 1) * 2);
    const sizeScore = Math.min(1, Math.min(w, h) / 80);
    const score = bonus + aspectScore * 2 + sizeScore;
    if (score > bestScore) { bestScore = score; bestResult = res; }
    console.log(
      `  模板匹配: TL(${Math.round(res.topLeft.x)},${Math.round(res.topLeft.y)}) ` +
      `大小 ${Math.round(w)}×${Math.round(h)}px, r=${r.toFixed(3)}, score=${score.toFixed(3)}`
    );
  }

  function rateAndRecord(res: QRCodeCorners, bonus: number) {
    const { topLeft, topRight, bottomLeft, bottomRight } = res;
    const wT = dist(topLeft, topRight), wB = dist(bottomLeft, bottomRight);
    const hL = dist(topLeft, bottomLeft), hR = dist(topRight, bottomRight);
    const aw = (wT + wB) / 2, ah = (hL + hR) / 2;
    const aspect = Math.max(aw, ah) / Math.max(1, Math.min(aw, ah));
    const aspectScore = 1 / (1 + Math.abs(aspect - 1) * 2);
    const sizeScore = Math.min(1, Math.min(aw, ah) / 80);
    const score = bonus + aspectScore * 2 + sizeScore;
    if (score > bestScore) { bestScore = score; bestResult = res; }
    return score;
  }

  // Step 2-1: 在密度图 ROI 内做模板匹配（最高优先级，但依赖密度图的 ROI 定位）
  // 改进：模板匹配现在复用 Step 2 中已算出的 density，不需要再独立计算一次密度图
  try {
    const { matchOnDensity } = await import('@/utils/templateMatcher');
    // 先加载样板图
    const { loadSamplePattern } = await import('@/utils/templateMatcher');
    const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/';
    const loaded = await loadSamplePattern(baseUrl);
    if (loaded) {
      // 如果密度图找到了区域，在 ROI 内搜索；否则用全图范围
      let roiGrid: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
      if (regionResult) {
        const xs = regionResult.corners.map(p => p.x), ys = regionResult.corners.map(p => p.y);
        const minPx = Math.min(...xs), maxPx = Math.max(...xs);
        const minPy = Math.min(...ys), maxPy = Math.max(...ys);
        // 向外扩展 1 个 cellSize，给边缘一点余量
        roiGrid = {
          minX: Math.max(0, Math.floor(minPx / cellSize) - 1),
          minY: Math.max(0, Math.floor(minPy / cellSize) - 1),
          maxX: Math.min(gridW - 1, Math.floor(maxPx / cellSize) + 1),
          maxY: Math.min(gridH - 1, Math.floor(maxPy / cellSize) + 1),
        };
      }
      const tmplResult = matchOnDensity(density, gridW, gridH, cellSize, roiGrid);
      if (tmplResult && tmplResult.score >= 0.35) {
        const tmplCorners = orderCorners([
          tmplResult.corners[0], tmplResult.corners[1],
          tmplResult.corners[2], tmplResult.corners[3],
        ]);
        rateAndRecordTmpl(tmplCorners, tmplResult.score);
      }
    }
  } catch (e) {
    console.warn('[QRDetector] 模板匹配失败:', (e as Error).message);
  }

  if (regionResult) {
    // ---- Step 2a: 密度图连通区 bbox（最直接，最不依赖卡片假设）
    // 如果密度图找到了一个"好的"区域（接近正方形），直接作为候选
    const xs = regionResult.corners.map((p) => p.x), ys = regionResult.corners.map((p) => p.y);
    const rW = Math.max(...xs) - Math.min(...xs);
    const rH = Math.max(...ys) - Math.min(...ys);
    const rRatio = Math.max(rW, rH) / Math.max(1, Math.min(rW, rH));
    info(`  密度图区: ${Math.round(rW)}×${Math.round(rH)}, 宽高比=${rRatio.toFixed(2)}`);
    if (rRatio < 2.0) {
      rateAndRecord(orderCorners(regionResult.corners), 2.3);
    }

    // ---- Step 2b: 白色边框检测（新方案，高权重）
    // 使用原始 RGB + 纹理跳变检测二维码外围白边
    const whiteBorder = detectWhiteBorderCorners(imageData.data, binary, width, height, regionResult);
    if (whiteBorder) {
      const scored = rateAndRecord(orderCorners(whiteBorder.corners), 2.8);
      console.log(
        `  白边检测: TL(${Math.round(whiteBorder.corners[0].x)},${Math.round(whiteBorder.corners[0].y)}) ` +
        `置信度=${whiteBorder.confidence.toFixed(0)}, score=${scored.toFixed(3)}`
      );
    } else {
      // 回退到老的卡片检测
      const cardCorners = detectCardCorners(binary, width, height, regionResult);
      if (cardCorners) {
        rateAndRecord(orderCorners(cardCorners), 1.8);
      }
    }

    // ---- Step 2c: ROI 内 FP 检测 ----
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - 2 * cellSize));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - 2 * cellSize));
    const x1 = Math.min(width, Math.ceil(Math.max(...xs) + 2 * cellSize));
    const y1 = Math.min(height, Math.ceil(Math.max(...ys) + 2 * cellSize));
    const fpsCandidates = detectFinderPatterns(binary, width, height, { minX: x0, minY: y0, maxX: x1, maxY: y1 });
    if (fpsCandidates.length >= 3) {
      const fpsResult = determineCornersFromFinderPatterns(fpsCandidates, width, height, binary);
      if (fpsResult) rateAndRecord(fpsResult, 2.0);
    }
    // 全图 FP（兜底）
    if (!bestResult || bestScore < 3) {
      const globalFps = detectFinderPatterns(binary, width, height, null);
      if (globalFps.length >= 3) {
        const fpsResult = determineCornersFromFinderPatterns(globalFps, width, height, binary);
        if (fpsResult) rateAndRecord(fpsResult, 2.0);
      }
    }
    // 四边形拟合（最后兜底）
    if (!bestResult || bestScore < 3) {
      const fitted = fitQuadrilateral(binary, width, height, regionResult.corners);
      const refined = refineCornersByTiming(binary, width, height, fitted);
      rateAndRecord(orderCorners(refined), 1.0);
    }
  } else {
    // 密度图失败：直接做全图 FP
    const globalFps = detectFinderPatterns(binary, width, height, null);
    if (globalFps.length >= 3) {
      const fpsResult = determineCornersFromFinderPatterns(globalFps, width, height, binary);
      if (fpsResult) rateAndRecord(fpsResult, 2.0);
    }
    // 还是失败：中央区域估计（兜底）
    if (!bestResult) {
      const cx = width / 2, cy = height * 0.4, halfSize = Math.min(width, height) * 0.22;
      const rough: Point[] = [
        { x: cx - halfSize, y: cy - halfSize },
        { x: cx + halfSize, y: cy - halfSize },
        { x: cx + halfSize, y: cy + halfSize },
        { x: cx - halfSize, y: cy + halfSize }
      ];
      rateAndRecord(orderCorners(rough), 0.2);
    }
  }

  if (!bestResult) {
    warn(`最终角点为 NULL`);
    return null;
  }

  logFinalResult(bestResult);
  return bestResult;
}

// 保留原有接口名兼容 (getLuminance 被外部引用)
export { getLuminance };
