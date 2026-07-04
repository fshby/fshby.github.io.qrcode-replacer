import type { Point, QRCodeCorners } from '@/types';

interface FinderPattern {
  center: Point;
  size: number;
  strength: number;
}

/**
 * 在二值图的一行扫描 "亮-暗-亮-暗-亮" 模式（1:1:3:1:1）。
 * 返回：{ centerX, size, score, endX } 或 null。
 */
function scanLine(
  binary: Uint8Array,
  width: number,
  startX: number,
  y: number,
  maxX: number
): { centerX: number; size: number; score: number; endX: number } | null {
  // 找到第一个黑像素
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
  if (total < 7) return null;
  const unit = total / 7;
  const tol = unit * 0.75;
  if (Math.abs(s1 - unit) < tol && Math.abs(s2 - unit) < tol &&
      Math.abs(s3 - unit * 3) < tol * 1.8 &&
      Math.abs(s4 - unit) < tol && Math.abs(s5 - unit) < tol &&
      s1 >= 1 && s5 >= 1 && s3 >= 2) {
    return { centerX: firstSegStart + s1 + s2 + s3 / 2, size: total, score: 10, endX: x };
  }
  return null;
}

/**
 * 扫描一列，同样找 1:1:3:1:1。
 */
function scanColumn(
  binary: Uint8Array, width: number, x: number, y: number, minY: number, maxY: number
): { centerY: number; size: number; score: number } | null {
  let yy = y;
  while (yy > minY && binary[yy * width + x] === 0) yy--;
  if (yy >= maxY) return null;
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
  const tol = unit * 0.75;
  if (Math.abs(s1 - unit) < tol && Math.abs(s2 - unit) < tol &&
      Math.abs(s3 - unit * 3) < tol * 1.8 &&
      Math.abs(s4 - unit) < tol && Math.abs(s5 - unit) < tol) {
    return { centerY: firstSegStart + s1 + s2 + s3 / 2, size: total, score: 10 };
  }
  return null;
}

/**
 * 在指定区域里做一次完整的 FP 扫描。
 */
function scanBinaryForPatterns(
  binary: Uint8Array,
  width: number,
  _height: number,
  minX: number, minY: number, maxX: number, maxY: number
): FinderPattern[] {
  const candidates: FinderPattern[] = [];
  const regionSize = Math.max(maxX - minX, maxY - minY);
  const minModule = Math.max(2, Math.floor(regionSize / 250));
  const stepY = Math.max(1, Math.floor(minModule / 2));

  for (let y = minY + stepY; y < maxY - stepY; y += stepY) {
    let x = minX;
    while (x < maxX - 4) {
      const h = scanLine(binary, width, x, y, maxX);
      if (h) {
        x = h.endX;
        const v = scanColumn(binary, width, Math.round(h.centerX), y, minY, maxY);
        if (v && Math.abs(h.size - v.size) < Math.max(h.size, v.size) * 0.6) {
          const center: Point = { x: h.centerX, y: v.centerY };
          const size = (h.size + v.size) / 2;
          const dup = candidates.find(
            c => Math.abs(c.center.x - center.x) < size &&
                  Math.abs(c.center.y - center.y) < size
          );
          if (dup) {
            dup.center.x = (dup.center.x + center.x) / 2;
            dup.center.y = (dup.center.y + center.y) / 2;
            dup.size = (dup.size + size) / 2;
            dup.strength += h.score + v.score;
          } else {
            candidates.push({ center, size, strength: h.score + v.score });
          }
        }
      } else {
        x++;
      }
    }
  }
  return candidates.sort((a, b) => b.strength - a.strength);
}

/**
 * 从候选列表中选三个呈直角三角形分布的点（这是二维码三个 Finder Pattern 的特征）。
 * 并据此推断出第四个角点。
 */
function pickThreeCorners(candidates: FinderPattern[], width: number, height: number): QRCodeCorners | null {
  if (candidates.length < 3) return null;

  const minDim = Math.min(width, height);
  const maxDist = minDim * 0.9;
  const minDist = Math.max(10, minDim * 0.02);

  // 组合枚举 topK 个候选，挑最接近"等腰直角三角形"的三元组
  const topK = Math.min(candidates.length, 8);
  const top = candidates.slice(0, topK);

  let best: { a: FinderPattern; b: FinderPattern; c: FinderPattern; geoScore: number; strength: number } | null = null;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      for (let k = j + 1; k < top.length; k++) {
        const a = top[i], b = top[j], c = top[k];
        const d1 = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
        const d2 = Math.hypot(b.center.x - c.center.x, b.center.y - c.center.y);
        const d3 = Math.hypot(a.center.x - c.center.x, a.center.y - c.center.y);
        if (d1 < minDist || d2 < minDist || d3 < minDist) continue;
        if (d1 > maxDist || d2 > maxDist || d3 > maxDist) continue;
        const arr = [d1, d2, d3].sort((p, q) => p - q);
        const shortAvg = (arr[0] + arr[1]) / 2;
        // 1) 两条短边尽可能相等
        const equalness = 1 - Math.min(1, Math.abs(arr[0] - arr[1]) / Math.max(1, arr[1]));
        // 2) 长边/短边尽量接近 √2 ≈ 1.414
        const ratio = arr[2] / Math.max(1, shortAvg);
        const ratioScore = 1 - Math.min(1, Math.abs(ratio - Math.SQRT2));
        // 3) 勾股定理：a^2 + b^2 ≈ c^2
        const pyErr = Math.abs(arr[0] * arr[0] + arr[1] * arr[1] - arr[2] * arr[2]) / (arr[2] * arr[2]);
        const pyScore = 1 - Math.min(1, pyErr);
        const geoScore = equalness * 0.3 + ratioScore * 0.35 + pyScore * 0.35;
        const strength = a.strength + b.strength + c.strength;
        // 先按几何得分排序；几何得分接近时才看 strength
        if (!best || geoScore > best.geoScore + 0.02 ||
            (geoScore >= best.geoScore - 0.02 && strength > best.strength)) {
          best = { a, b, c, geoScore, strength };
        }
      }
    }
  }
  if (!best || best.geoScore < 0.4) return null;

  // 找出直角点：与另两点距离较短的两条边的公共点
  const pts = [best.a, best.b, best.c];
  // 找到三条边中最长的一条；最长边两端不是直角点，直角是另外一个
  const dAB = Math.hypot(pts[0].center.x - pts[1].center.x, pts[0].center.y - pts[1].center.y);
  const dBC = Math.hypot(pts[1].center.x - pts[2].center.x, pts[1].center.y - pts[2].center.y);
  const dAC = Math.hypot(pts[0].center.x - pts[2].center.x, pts[0].center.y - pts[2].center.y);
  let rightIdx = 0;
  if (dAB >= dBC && dAB >= dAC) rightIdx = 2;
  else if (dBC >= dAB && dBC >= dAC) rightIdx = 0;
  else rightIdx = 1;

  const right = pts[rightIdx];
  const others = pts.filter((_, i) => i !== rightIdx);
  const cornerSize = right.size;
  const offset = cornerSize * 0.5;

  // 二维码中心在 right 点的 "远离其它两点中心的反方向
  const avgX = (others[0].center.x + others[1].center.x) / 2;
  const avgY = (others[0].center.y + others[1].center.y) / 2;
  const outwardX = right.center.x - avgX;
  const outwardY = right.center.y - avgY;
  const outwardLen = Math.max(1, Math.hypot(outwardX, outwardY));
  const nx = outwardX / outwardLen;
  const ny = outwardY / outwardLen;

  const topLeft: Point = { x: right.center.x + nx * offset, y: right.center.y + ny * offset };

  // 对另外两个 FP 也向外扩展 0.5 个模块
  function expandCorner(fp: FinderPattern): Point {
    const dx = fp.center.x - right.center.x;
    const dy = fp.center.y - right.center.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    return {
      x: fp.center.x + (dx / len) * offset,
      y: fp.center.y + (dy / len) * offset
    };
  }
  const c1 = expandCorner(others[0]);
  const c2 = expandCorner(others[1]);
  const c4: Point = { x: c1.x + c2.x - topLeft.x, y: c1.y + c2.y - topLeft.y };

  // 最后排序：左上、右上、右下、左下
  const all = [topLeft, c1, c2, c4];
  let tl = 0, tr = 0, br = 0, bl = 0;
  let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < 4; i++) {
    const p = all[i];
    const s = p.x + p.y;
    const d = p.x - p.y;
    if (s < minS) { minS = s; tl = i; }
    if (s > maxS) { maxS = s; br = i; }
    if (d < minD) { minD = d; bl = i; }
    if (d > maxD) { maxD = d; tr = i; }
  }
  return {
    topLeft: all[tl],
    topRight: all[tr],
    bottomRight: all[br],
    bottomLeft: all[bl]
  };
}

/**
 * 检测二维码的三个 Finder Pattern 并返回四角坐标。
 *
 * 重载 1：传入 HTMLCanvasElement（自动 Otsu 二值化 + 正反色扫描）
 * 重载 2：传入已二值化的 Uint8Array + width + height（复用调用方的二值图）
 */
export function detectFinderPatterns(
  src: HTMLCanvasElement | Uint8Array,
  widthArg?: number,
  heightArg?: number
): QRCodeCorners | null {
  let binary: Uint8Array;
  let width: number;
  let height: number;

  if (src instanceof Uint8Array) {
    binary = src;
    width = widthArg!;
    height = heightArg!;
  } else {
    const canvas = src;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    width = canvas.width;
    height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);

    // 彩色背景过滤（微信支付码绿底等）—— 让绿色/蓝色/红色单色背景像素视为白背景
    const isColored = (r: number, g: number, b: number): boolean => {
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (maxC - minC < 50) return false;
      if (maxC < 120) return false;
      return (r + g + b) / 3 > 80;
    };

    // Otsu 二值化
    const hist = new Uint32Array(256);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
      const lum = isColored(r, g, b) ? 255 : Math.round((r + g + b) / 3);
      hist[lum]++;
    }
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, maxVar = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = width * height - wB;
      if (wF === 0) break;
      sB += t * hist[t];
      const mB = sB / wB;
      const mF = (sum - sB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; thr = t; }
    }
    binary = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
      const lum = isColored(r, g, b) ? 255 : (r + g + b) / 3;
      binary[i] = lum < thr ? 1 : 0;
    }
  }

  // 先正色扫描
  const normal = scanBinaryForPatterns(binary, width, height, 0, 0, width, height);
  if (normal.length >= 3) {
    const res = pickThreeCorners(normal, width, height);
    if (res) return res;
  }
  // 反色扫描（有些二维码是浅色块在深色背景上）
  const inverted = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) inverted[i] = binary[i] ? 0 : 1;
  const inv = scanBinaryForPatterns(inverted, width, height, 0, 0, width, height);
  if (inv.length >= 3) return pickThreeCorners(inv, width, height);
  return null;
}
