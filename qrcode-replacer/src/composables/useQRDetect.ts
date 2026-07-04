import { ref } from 'vue';
import jsQR from 'jsqr';
import type { QRDetectResult, QRCodeCorners, Point } from '@/types';
import { detectFinderPatterns } from '@/utils/finderPatternDetector';
import { detectQRCornersByImageFeatures } from '@/utils/featureBasedDetector';
import { normalizeCorners } from '@/utils/perspectiveUtils';

export function useQRDetect() {
  const isDetecting = ref(false);
  const lastResult = ref<QRDetectResult | null>(null);

  /**
   * 统一调用 perspectiveUtils.normalizeCorners 来排序：
   * 去重 → 质心极角排序 → 叉积判定顺时针 → y 最小作为 TL
   * 输出顺序固定：TL → TR → BR → BL
   */
  function sortCorners(corners: Point[]): QRCodeCorners {
    const ordered = normalizeCorners(corners);
    return {
      topLeft: ordered[0],
      topRight: ordered[1],
      bottomRight: ordered[2],
      bottomLeft: ordered[3]
    };
  }

  /** 在给定 canvas 上跑 jsQR（内部失败时会自动缩放重试），返回 QRCodeCorners（失败为 null） */
  function tryJsQR(canvas: HTMLCanvasElement): { data: string; corners: QRCodeCorners } | null {
    // ---- Step A: 直接在原图上跑 jsQR ----
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const W = canvas.width, H = canvas.height;
    const imageData = ctx.getImageData(0, 0, W, H);
    const code = jsQR(imageData.data, W, H, { inversionAttempts: 'attemptBoth' });
    if (code) {
      return { data: code.data, corners: cornersFromCode(code) };
    }

    // ---- Step B: 原图失败 → 检查是否因尺寸过大导致 jsQR 退化 ----
    // 估计当前模块大小（≈ 中间行/列跳变间距的平均值），若 > 20px 说明图像过大，
    // 缩放到模块 ≈ 10px 后再跑一次（缩放=抗大分辨率的抖动）
    const estMod = estimateModuleSize(imageData.data, W, H);
    console.log(`[tryJsQR] 原图 ${W}×${H} 失败；估计模块 ≈ ${estMod}px`);

    // 策略1：按估计模块大小缩放
    if (estMod > 20) {
      const scale = 10 / estMod; // 目标：模块 ≈ 10px
      const tryScaled = runJsQROnScaled(canvas, scale, W, H);
      if (tryScaled) return tryScaled;
    }

    // 策略2：图片非常大（> 2000px），强制缩到 1200px 宽再试
    if (W > 2000 || H > 2000) {
      const scale = 1200 / Math.max(W, H);
      const tryScaled = runJsQROnScaled(canvas, scale, W, H);
      if (tryScaled) return tryScaled;
    }

    // 策略3：图像四个边 100% 黑色 → 边缘全黑会干扰 jsQR 的 FP 检测；
    // 把四条黑色边缘"切掉"再跑
    const edgeDark = countEdgeDark(imageData.data, W, H);
    if (edgeDark > 0.85) {
      const cropped = cropBlackBorders(canvas, imageData.data, W, H);
      if (cropped && (cropped.cw < W || cropped.ch < H)) {
        console.log(`[tryJsQR] 边缘 100% 黑色 → 裁掉后重试 ${cropped.cw}×${cropped.ch}`);
        const tryCrop = tryJsQR(cropped.canvas);
        if (tryCrop) {
          // 把裁剪后坐标系的四角还原回原图坐标系
          const scaleBack = (p: Point) => ({ x: p.x + cropped!.offsetX, y: p.y + cropped!.offsetY });
          return {
            data: tryCrop.data,
            corners: {
              topLeft: scaleBack(tryCrop.corners.topLeft),
              topRight: scaleBack(tryCrop.corners.topRight),
              bottomRight: scaleBack(tryCrop.corners.bottomRight),
              bottomLeft: scaleBack(tryCrop.corners.bottomLeft),
            },
          };
        }
      }
    }

    // 失败，打印图像特征
    analyzeImageFail(imageData, W, H);
    return null;
  }

  function cornersFromCode(code: any): QRCodeCorners {
    const allCorners: Point[] = [
      { x: code.location.topLeftCorner.x, y: code.location.topLeftCorner.y },
      { x: code.location.topRightCorner.x, y: code.location.topRightCorner.y },
      { x: code.location.bottomLeftCorner.x, y: code.location.bottomLeftCorner.y },
      { x: code.location.bottomRightCorner.x, y: code.location.bottomRightCorner.y },
    ];
    return sortCorners(allCorners);
  }

  /** 在 canvas 上按 scale 缩放后跑 jsQR；成功时把四角放大回原图坐标 */
  function runJsQROnScaled(canvas: HTMLCanvasElement, scale: number, origW: number, origH: number) {
    const cw = Math.max(200, Math.round(origW * scale));
    const ch = Math.max(200, Math.round(origH * scale));
    const tmp = document.createElement('canvas');
    tmp.width = cw; tmp.height = ch;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    if (!tctx) return null;
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(canvas, 0, 0, cw, ch);
    const imgData = tctx.getImageData(0, 0, cw, ch);
    const code = jsQR(imgData.data, cw, ch, { inversionAttempts: 'attemptBoth' });
    if (!code) return null;
    console.log(`[tryJsQR] 缩放到 ${cw}×${ch} 后识别成功 → ${code.data.slice(0, 40)}...`);
    // 四角坐标按比例放大回原图
    const rx = origW / cw, ry = origH / ch;
    const allCorners: Point[] = [
      { x: code.location.topLeftCorner.x * rx, y: code.location.topLeftCorner.y * ry },
      { x: code.location.topRightCorner.x * rx, y: code.location.topRightCorner.y * ry },
      { x: code.location.bottomLeftCorner.x * rx, y: code.location.bottomLeftCorner.y * ry },
      { x: code.location.bottomRightCorner.x * rx, y: code.location.bottomRightCorner.y * ry },
    ];
    return { data: code.data, corners: sortCorners(allCorners) };
  }

  /** 从图像中间行/列估计平均模块大小 */
  function estimateModuleSize(data: Uint8ClampedArray, W: number, H: number): number {
    const midY = Math.floor(H / 2), midX = Math.floor(W / 2);
    // 中间行
    let lastVal = -1, run = 0, sumGap = 0, nGaps = 0;
    for (let x = 0; x < W; x++) {
      const idx = (midY * W + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      const v = lum < 128 ? 0 : 1;
      if (lastVal === -1) { lastVal = v; run = 1; continue; }
      if (v === lastVal) run++;
      else { sumGap += run; nGaps++; lastVal = v; run = 1; }
    }
    const rowAvg = nGaps > 0 ? sumGap / nGaps : 0;
    // 中间列
    lastVal = -1; run = 0; sumGap = 0; nGaps = 0;
    for (let y = 0; y < H; y++) {
      const idx = (y * W + midX) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      const v = lum < 128 ? 0 : 1;
      if (lastVal === -1) { lastVal = v; run = 1; continue; }
      if (v === lastVal) run++;
      else { sumGap += run; nGaps++; lastVal = v; run = 1; }
    }
    const colAvg = nGaps > 0 ? sumGap / nGaps : 0;
    return (rowAvg + colAvg) / 2 || 10;
  }

  /** 四条边缘带中的"暗像素比例"（<64 视为暗） */
  function countEdgeDark(data: Uint8ClampedArray, W: number, H: number): number {
    const band = Math.max(1, Math.floor(Math.min(W, H) * 0.02));
    let dark = 0, total = 0;
    for (let x = 0; x < W; x++) {
      for (let yy = 0; yy < band; yy++) {
        const i = (yy * W + x) * 4;
        dark += (data[i] + data[i + 1] + data[i + 2]) / 3 < 64 ? 1 : 0;
        total++;
      }
      for (let yy = H - band; yy < H; yy++) {
        const i = (yy * W + x) * 4;
        dark += (data[i] + data[i + 1] + data[i + 2]) / 3 < 64 ? 1 : 0;
        total++;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let xx = 0; xx < band; xx++) {
        const i = (y * W + xx) * 4;
        dark += (data[i] + data[i + 1] + data[i + 2]) / 3 < 64 ? 1 : 0;
        total++;
      }
      for (let xx = W - band; xx < W; xx++) {
        const i = (y * W + xx) * 4;
        dark += (data[i] + data[i + 1] + data[i + 2]) / 3 < 64 ? 1 : 0;
        total++;
      }
    }
    return total ? dark / total : 0;
  }

  /** 裁切四个边的纯黑背景，返回新 canvas + 偏移坐标 */
  function cropBlackBorders(
    _canvas: HTMLCanvasElement, data: Uint8ClampedArray, W: number, H: number
  ): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number; cw: number; ch: number } | null {
    const band = Math.max(1, Math.floor(Math.min(W, H) * 0.02));
    // 找黑边边界：从外向内扫描，遇到非黑像素即停止
    function isRowDark(y: number): boolean {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 60) return false;
      }
      return true;
    }
    function isColDark(x: number): boolean {
      for (let y = 0; y < H; y++) {
        const i = (y * W + x) * 4;
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 60) return false;
      }
      return true;
    }
    let top = 0, bottom = H - 1, left = 0, right = W - 1;
    while (top < H - 1 && isRowDark(top)) top++;
    while (bottom > top && isRowDark(bottom)) bottom--;
    while (left < W - 1 && isColDark(left)) left++;
    while (right > left && isColDark(right)) right--;

    const cw = right - left + 1, ch = bottom - top + 1;
    if (cw < 100 || ch < 100 || (cw === W && ch === H)) return null;
    // 裁剪时外扩 band 像素，避免裁到二维码本身
    const ox = Math.max(0, left - band);
    const oy = Math.max(0, top - band);
    const ow = Math.min(W, right + band + 1) - ox;
    const oh = Math.min(H, bottom + band + 1) - oy;
    const out = document.createElement('canvas');
    out.width = ow; out.height = oh;
    const octx = out.getContext('2d', { willReadFrequently: true });
    if (!octx) return null;
    octx.drawImage(_canvas, ox, oy, ow, oh, 0, 0, ow, oh);
    return { canvas: out, offsetX: ox, offsetY: oy, cw: ow, ch: oh };
  }

  /** 打印图像核心特征：尺寸、亮度分布、边缘像素、可能的模块大小等 */
  function analyzeImageFail(imageData: ImageData, W: number, H: number) {
    const data = imageData.data;
    // 1) 基础统计：平均亮度、最大/最小亮度、alpha 通道是否有非 255 值
    let sumLum = 0, minLum = 255, maxLum = 0;
    let alphaCount = 0, nonAlphaCount = 0;
    // 2) 亮度直方图（16 个 bucket）
    const hist = new Array(16).fill(0);
    // 3) 估计模块大小：扫描中间一行/一列，统计黑白跳变间距
    const midY = Math.floor(H / 2), midX = Math.floor(W / 2);
    let rowTransitions = 0, rowSumGap = 0, rowLastVal = -1, rowFirstGap = 0;
    let colTransitions = 0, colSumGap = 0, colLastVal = -1, colFirstGap = 0;
    let runLen = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
        // 按感知亮度
        const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        sumLum += lum;
        if (lum < minLum) minLum = lum;
        if (lum > maxLum) maxLum = lum;
        if (a !== 255) alphaCount++; else nonAlphaCount++;
        hist[Math.min(15, Math.floor(lum / 16))]++;

        // 中间行/列扫描
        if (y === midY) {
          const val = lum < 128 ? 0 : 1;
          if (rowLastVal === -1) { rowLastVal = val; runLen = 1; }
          else if (val === rowLastVal) runLen++;
          else {
            rowTransitions++;
            if (rowTransitions === 1) rowFirstGap = runLen;
            rowSumGap += runLen;
            rowLastVal = val;
            runLen = 1;
          }
        }
        if (x === midX) {
          const val = lum < 128 ? 0 : 1;
          if (colLastVal === -1) { colLastVal = val; runLen = 1; }
          else if (val === colLastVal) runLen++;
          else {
            colTransitions++;
            if (colTransitions === 1) colFirstGap = runLen;
            colSumGap += runLen;
            colLastVal = val;
            runLen = 1;
          }
        }
      }
    }

    const totalPx = W * H;
    const avgLum = sumLum / totalPx;
    const avgRowGap = rowTransitions ? rowSumGap / rowTransitions : 0;
    const avgColGap = colTransitions ? colSumGap / colTransitions : 0;

    // 4) 检查四条边缘带（1%宽度）是否"干净"：边缘亮度过高或过低可能影响 Finder Pattern
    const edgeBand = Math.max(1, Math.floor(Math.min(W, H) * 0.02));
    let edgeDark = 0, edgeLight = 0, edgeTotal = 0;
    for (let x = 0; x < W; x++) {
      for (let yy = 0; yy < edgeBand; yy++) {
        const i = (yy * W + x) * 4;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        edgeDark += lum < 64 ? 1 : 0;
        edgeLight += lum > 180 ? 1 : 0;
        edgeTotal++;
      }
      for (let yy = H - edgeBand; yy < H; yy++) {
        const i = (yy * W + x) * 4;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        edgeDark += lum < 64 ? 1 : 0;
        edgeLight += lum > 180 ? 1 : 0;
        edgeTotal++;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let xx = 0; xx < edgeBand; xx++) {
        const i = (y * W + xx) * 4;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        edgeDark += lum < 64 ? 1 : 0;
        edgeLight += lum > 180 ? 1 : 0;
        edgeTotal++;
      }
      for (let xx = W - edgeBand; xx < W; xx++) {
        const i = (y * W + xx) * 4;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        edgeDark += lum < 64 ? 1 : 0;
        edgeLight += lum > 180 ? 1 : 0;
        edgeTotal++;
      }
    }

    // 5) 直方图分布特征：是否双峰（黑白）、是否"脏"（中间灰很多）
    const dark = hist.slice(0, 4).reduce((a, b) => a + b, 0);
    const mid = hist.slice(4, 12).reduce((a, b) => a + b, 0);
    const light = hist.slice(12).reduce((a, b) => a + b, 0);
    const bimodal = dark > totalPx * 0.1 && light > totalPx * 0.1 && mid < totalPx * 0.3;

    const report: Record<string, number | string> = {
      size: `${W} × ${H}`,
      totalPixels: totalPx,
      avgLuminance: Math.round(avgLum),
      minLuminance: minLum,
      maxLuminance: maxLum,
      contrast: maxLum - minLum,
      alphaPixels: alphaCount,
      nonAlphaPixels: nonAlphaCount,
      darkPx_pct: Math.round((dark / totalPx) * 100),
      midGrayPx_pct: Math.round((mid / totalPx) * 100),
      lightPx_pct: Math.round((light / totalPx) * 100),
      bimodal: bimodal ? 'TRUE (清晰黑白)' : 'FALSE (中间灰多，可能模糊/JPG噪声)',
      midRow_transitions: rowTransitions,
      midRow_avgGap_px: Math.round(avgRowGap),
      midRow_firstGap_px: rowFirstGap,
      midCol_transitions: colTransitions,
      midCol_avgGap_px: Math.round(avgColGap),
      midCol_firstGap_px: colFirstGap,
      estimatedModule_pixel: Math.round((avgRowGap + avgColGap) / 2),
      edgeDark_pct: Math.round((edgeDark / edgeTotal) * 100),
      edgeLight_pct: Math.round((edgeLight / edgeTotal) * 100),
    };
    console.table(report);
    console.log('[analyze] Histogram (luminance buckets 0..15):',
      hist.map((h, i) => `${i*16}-${i*16+15}:${Math.round(h/totalPx*100)}%`).join(' | '));
  }

  async function detect(canvas: HTMLCanvasElement): Promise<QRDetectResult> {
    isDetecting.value = true;
    try {
      // Step 1: 跑 jsQR（内部会自动做「原图 → 按模块缩放 → 裁黑边」三级回退）
      const original = tryJsQR(canvas);
      if (original) {
        console.log('QR Code detected:', {
          data: original.data,
          corners: original.corners
        });
        const result: QRDetectResult = { success: true, corners: original.corners, data: original.data };
        lastResult.value = result;
        return result;
      }

      // Step 2: jsQR 三级回退都失败 → 图像特征检测（内部走密度图+FP+模板匹配+四边形拟合）
      console.log('jsQR still failed, trying image feature based detection...');
      const fallbackCorners = await detectQRCornersByImageFeatures(canvas);
      if (fallbackCorners) {
        console.log('Image feature detection succeeded:', fallbackCorners);
        const result: QRDetectResult = {
          success: true,
          corners: fallbackCorners,
          data: '',
          method: 'image-feature'
        };
        lastResult.value = result;
        return result;
      }

      // Step 3: 兜底：旧版 finder pattern 检测
      console.log('Image feature detection failed, trying old finder pattern detection...');
      const lastFallback = detectFinderPatterns(canvas);
      if (lastFallback) {
        console.log('Finder pattern detection succeeded:', lastFallback);
        const result: QRDetectResult = {
          success: true,
          corners: lastFallback,
          data: '',
          method: 'finder-pattern'
        };
        lastResult.value = result;
        return result;
      }

      return { success: false, error: '未检测到二维码，请手动标记角点' };
    } catch (err) {
      console.error('Detection error:', err);
      const result: QRDetectResult = {
        success: false,
        error: err instanceof Error ? err.message : '检测失败'
      };
      lastResult.value = result;
      return result;
    } finally {
      isDetecting.value = false;
    }
  }

  async function validate(canvas: HTMLCanvasElement): Promise<boolean> {
    const result = await detect(canvas);
    return result.success;
  }

  return {
    isDetecting,
    lastResult,
    detect,
    validate
  };
}

