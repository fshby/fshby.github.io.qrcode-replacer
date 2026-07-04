import type { Point } from '@/types';

/**
 * 基于密度图的模板匹配 —— 用于定位伪二维码
 *
 * 核心思路：
 *   1. 样板图 (qr-sample.png) 生成自己的密度网格
 *   2. 用户上传图也生成相同分辨率的密度网格
 *   3. 在上传图网格上滑窗，找与样板图"最相似"的区域
 *   4. 相似度用 Pearson 相关系数衡量，抗亮度和对比度差异
 *
 * 改进 (2026-07-04)：
 *   - 移除全图搜索，改为仅在 density 图的高纹理 ROI 附近搜索
 *   - 增加详细日志，方便排查问题
 *   - 多尺度搜索（3 个窗口大小）
 */

// ---------- 内部状态：缓存样板图密度网格 ----------
interface SamplePattern {
  density: Float32Array;
  gridW: number;
  gridH: number;
  cellPx: number;        // 每个密度格对应原图像素
  mean: number;
  centered: Float32Array;  // 均值中心化后的网格（方便 Pearson 计算）
  sumSq: number;           // Σ(value - mean)²
}

let cached: SamplePattern | null = null;
let loadError: string | null = null;

/**
 * 加载样板图 (public/templates/qr-sample.png)，转换成密度网格
 * @param baseUrl Vite 的 base URL，如 "/" 或 "./" 或 "/subpath/"
 */
export async function loadSamplePattern(baseUrl = ''): Promise<SamplePattern | null> {
  if (cached) return cached;
  if (loadError) {
    console.warn(`[TemplateMatcher] 上次加载已失败: ${loadError}`);
    return null;
  }

  // 规范化 URL：确保末尾有斜杠
  const base = baseUrl || '/';
  const url = `${base}templates/qr-sample.png`;
  console.log(`[TemplateMatcher] 尝试加载样板图: ${url}`);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });

  if (!loaded) {
    loadError = `无法加载 ${url}（可能是 404 或跨域问题）`;
    console.warn(`[TemplateMatcher] ${loadError}`);
    return null;
  }

  // 绘制到 canvas，取灰度
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    loadError = '无法创建 canvas 2D context';
    return null;
  }
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const gray = imageDataToGray(imageData.data, img.width, img.height);

  // 计算样板图的密度网格 —— cellSize 与后续上传图保持一致
  // 经验：cellSize = img.width / 25 (样板图约 25 模块宽度)
  const cellPx = Math.max(4, Math.floor(img.width / 30));
  const { density, gridW, gridH } = computeDensityGridFast(gray, img.width, img.height, cellPx);

  // 预计算均值 + 中心化
  let sum = 0;
  for (let i = 0; i < density.length; i++) sum += density[i];
  const mean = sum / density.length;
  const centered = new Float32Array(density.length);
  let sumSq = 0;
  for (let i = 0; i < density.length; i++) {
    centered[i] = density[i] - mean;
    sumSq += centered[i] * centered[i];
  }

  cached = { density, gridW, gridH, cellPx, mean, centered, sumSq };
  console.log(
    `[TemplateMatcher] 样板图加载成功: ${img.width}×${img.height}px, ` +
    `密度网格 ${gridW}×${gridH}, cellSize=${cellPx}px`
  );
  return cached;
}

// ---------- 工具：ImageData → 灰度 ----------
function imageDataToGray(data: Uint8ClampedArray, _w: number, _h: number): Uint8Array {
  const n = data.length / 4;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114 + 500) / 1000;
  }
  return out;
}

// ---------- 工具：快速密度网格 ----------
function computeDensityGridFast(
  gray: Uint8Array, width: number, height: number, cellPx: number
): { density: Float32Array; gridW: number; gridH: number } {
  const gridW = Math.ceil(width / cellPx);
  const gridH = Math.ceil(height / cellPx);
  const density = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = gx * cellPx;
      const y0 = gy * cellPx;
      const x1 = Math.min(x0 + cellPx, width);
      const y1 = Math.min(y0 + cellPx, height);
      let transitions = 0, count = 0;

      // 每 3 行扫一次水平跳变
      const rowStep = Math.max(1, Math.floor(cellPx / 3));
      for (let y = y0; y < y1; y += rowStep) {
        let prev: number | null = null;
        for (let x = x0; x < x1; x++) {
          const v = gray[y * width + x] < 128 ? 1 : 0;
          if (prev !== null && v !== prev) transitions++;
          prev = v;
          count++;
        }
      }
      // 每 3 列扫一次垂直跳变
      const colStep = Math.max(1, Math.floor(cellPx / 3));
      for (let x = x0; x < x1; x += colStep) {
        let prev: number | null = null;
        for (let y = y0; y < y1; y++) {
          const v = gray[y * width + x] < 128 ? 1 : 0;
          if (prev !== null && v !== prev) transitions++;
          prev = v;
          count++;
        }
      }
      density[gy * gridW + gx] = Math.min(100, (transitions / Math.max(1, count)) * 150);
    }
  }
  return { density, gridW, gridH };
}

// ---------- 核心：基于密度图的模板匹配 ----------
export interface MatchResult {
  corners: [Point, Point, Point, Point];
  score: number;  // Pearson r, ∈ [-1, 1]
  windowSize: number;
}

/**
 * 在密度图上执行模板匹配搜索
 * @param density  大图密度网格
 * @param gridW    大图网格宽度
 * @param gridH    大图网格高度
 * @param cellPx   每个网格的像素大小
 * @param roi      可选的搜索 ROI（网格坐标），不提供则全图搜
 */
export function matchOnDensity(
  density: Float32Array,
  gridW: number,
  gridH: number,
  cellPx: number,
  roi?: { minX: number; minY: number; maxX: number; maxY: number }
): MatchResult | null {
  if (!cached) {
    console.warn('[TemplateMatcher] 样板图未加载，跳过模板匹配');
    return null;
  }

  // 搜索范围：用 ROI 提供的边界（若有），否则全图
  const sx0 = roi ? Math.max(0, roi.minX) : 0;
  const sy0 = roi ? Math.max(0, roi.minY) : 0;
  const sx1 = roi ? Math.min(gridW, roi.maxX + 1) : gridW;
  const sy1 = roi ? Math.min(gridH, roi.maxY + 1) : gridH;
  const roiW = sx1 - sx0;
  const roiH = sy1 - sy0;

  // 多尺度窗口大小（网格单位）
  const sw = cached.gridW;
  const scales = [Math.floor(sw * 0.75), sw, Math.floor(sw * 1.3), Math.floor(sw * 1.7)]
    .filter(s => s > 5 && s < Math.min(roiW, roiH));
  if (scales.length === 0) {
    console.warn(`[TemplateMatcher] ROI 太小 (${roiW}×${roiH})，无法模板匹配 (样板=${sw}×${cached.gridH})`);
    return null;
  }

  let best: { r: number; gx: number; gy: number; win: number } | null = null;

  for (const win of scales) {
    // 重采样样板到当前窗口大小
    const resCentered = resampleGrid(cached.centered, cached.gridW, cached.gridH, win, win);
    let resSum = 0, resSq = 0;
    for (let i = 0; i < resCentered.length; i++) {
      resSum += resCentered[i];
      resSq += resCentered[i] * resCentered[i];
    }
    const resMean = resSum / resCentered.length;
    // 再做一次中心化（因为重采样后均值可能变）
    const finalCentered = new Float32Array(resCentered.length);
    let finalSumSq = 0;
    for (let i = 0; i < resCentered.length; i++) {
      finalCentered[i] = resCentered[i] - resMean;
      finalSumSq += finalCentered[i] * finalCentered[i];
    }
    if (finalSumSq < 1e-3) continue;

    // 滑窗搜索（步长 = max(1, win/4) 提速）
    const step = Math.max(1, Math.floor(win / 4));
    for (let gy = sy0; gy <= sy1 - win; gy += step) {
      for (let gx = sx0; gx <= sx1 - win; gx += step) {
        // 计算窗口统计
        let sum = 0;
        for (let dy = 0; dy < win; dy++) {
          for (let dx = 0; dx < win; dx++) {
            sum += density[(gy + dy) * gridW + (gx + dx)];
          }
        }
        const winMean = sum / (win * win);

        // Pearson 相关系数
        let covariance = 0, sumSqWin = 0;
        for (let dy = 0; dy < win; dy++) {
          for (let dx = 0; dx < win; dx++) {
            const v = density[(gy + dy) * gridW + (gx + dx)] - winMean;
            const s = finalCentered[dy * win + dx];
            covariance += v * s;
            sumSqWin += v * v;
          }
        }
        if (sumSqWin < 10) continue;  // 太平滑的区域（白卡片/纯黑）
        const r = covariance / Math.sqrt(sumSqWin * finalSumSq + 1e-6);
        if (!best || r > best.r) best = { r, gx, gy, win };
      }
    }
  }

  if (!best || best.r < 0.35) {
    console.log(`[TemplateMatcher] 未找到匹配 (最佳 r=${best?.r.toFixed(3) ?? 'null'}，阈值=0.35)`);
    return null;
  }

  // 还原到像素坐标
  const pxX0 = best.gx * cellPx;
  const pxY0 = best.gy * cellPx;
  const pxSize = best.win * cellPx;
  const actualSize = pxSize;

  console.log(
    `[TemplateMatcher] ✓ 最佳匹配: (${Math.round(pxX0)},${Math.round(pxY0)}) ` +
    `大小 ${Math.round(actualSize)}px, r=${best.r.toFixed(3)}, scale=${best.win}`
  );

  return {
    corners: [
      { x: pxX0, y: pxY0 },
      { x: pxX0 + actualSize, y: pxY0 },
      { x: pxX0 + actualSize, y: pxY0 + actualSize },
      { x: pxX0, y: pxY0 + actualSize },
    ],
    score: best.r,
    windowSize: actualSize,
  };
}

// ---------- 网格重采样（最近邻，够用）----------
function resampleGrid(
  src: Float32Array,
  srcW: number, srcH: number,
  dstW: number, dstH: number
): Float32Array {
  const out = new Float32Array(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * scaleX));
      const sy = Math.min(srcH - 1, Math.floor(y * scaleY));
      out[y * dstW + x] = src[sy * srcW + sx];
    }
  }
  return out;
}

// ---------- 简化的对外接口：从 ImageData 直接跑 ----------
export async function matchByTemplateFromImageData(
  imageData: ImageData,
  baseUrl = ''
): Promise<MatchResult | null> {
  const sample = await loadSamplePattern(baseUrl);
  if (!sample) return null;

  const gray = imageDataToGray(imageData.data, imageData.width, imageData.height);
  const { density, gridW, gridH } = computeDensityGridFast(
    gray, imageData.width, imageData.height, sample.cellPx
  );
  return matchOnDensity(density, gridW, gridH, sample.cellPx);
}

// ---------- 新增便捷接口 1：使用已有的 density 做模板匹配 ----------
export async function matchOnDensityWithSample(
  density: Float32Array,
  gridW: number,
  gridH: number,
  cellPx: number,
  roi?: { minX: number; minY: number; maxX: number; maxY: number }
): Promise<MatchResult | null> {
  const sample = await loadSamplePattern('');
  if (!sample) {
    console.warn('[TemplateMatcher] matchOnDensityWithSample: 样板图加载失败，返回 null');
    return null;
  }
  console.log(
    `[TemplateMatcher] matchOnDensityWithSample: 传入 density=${gridW}×${gridH}, ` +
    `cellPx=${cellPx}${roi ? `, ROI=(${roi.minX},${roi.minY})-(${roi.maxX},${roi.maxY})` : ''}`
  );
  return matchOnDensity(density, gridW, gridH, cellPx, roi);
}

// ---------- 新增便捷接口 2：从 ImageData + ROI（像素坐标）直接跑 ----------
export async function matchByTemplateFromImageDataWithROI(
  imageData: ImageData,
  baseUrl: string,
  roi?: { minX: number; minY: number; maxX: number; maxY: number }
): Promise<MatchResult | null> {
  const sample = await loadSamplePattern(baseUrl);
  if (!sample) return null;

  const cellPx = sample.cellPx;
  console.log(
    `[TemplateMatcher] matchByTemplateFromImageDataWithROI: ` +
    `图像 ${imageData.width}×${imageData.height}px, cellPx=${cellPx}` +
    `${roi ? `, 像素ROI=(${roi.minX},${roi.minY})-(${roi.maxX},${roi.maxY})` : ''}`
  );

  const gray = imageDataToGray(imageData.data, imageData.width, imageData.height);
  const { density, gridW, gridH } = computeDensityGridFast(
    gray, imageData.width, imageData.height, cellPx
  );

  let gridRoi: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  if (roi) {
    gridRoi = {
      minX: Math.max(0, Math.floor(roi.minX / cellPx)),
      minY: Math.max(0, Math.floor(roi.minY / cellPx)),
      maxX: Math.min(gridW - 1, Math.floor(roi.maxX / cellPx)),
      maxY: Math.min(gridH - 1, Math.floor(roi.maxY / cellPx)),
    };
    console.log(
      `[TemplateMatcher] 像素ROI → 网格ROI: ` +
      `(${gridRoi.minX},${gridRoi.minY})-(${gridRoi.maxX},${gridRoi.maxY})`
    );
  }

  return matchOnDensity(density, gridW, gridH, cellPx, gridRoi);
}
