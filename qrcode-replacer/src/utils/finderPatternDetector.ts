import type { Point, QRCodeCorners } from '@/types';

interface FinderPattern {
  center: Point;
  size: number;
  strength: number;
}

function getPixelBrightness(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const idx = (y * width + x) * 4;
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  return (r + g + b) / 3;
}

function isDark(data: Uint8ClampedArray, width: number, x: number, y: number, threshold: number = 128): boolean {
  return getPixelBrightness(data, width, x, y) < threshold;
}

function scanHorizontalLine(data: Uint8ClampedArray, width: number, _height: number, y: number, threshold: number): number[] | null {
  const patterns: number[] = [];
  let currentState = isDark(data, width, 0, y, threshold);
  let segmentStart = 0;

  for (let x = 1; x < width; x++) {
    const nextState = isDark(data, width, x, y, threshold);
    if (nextState !== currentState) {
      const segmentLength = x - segmentStart;
      patterns.push(segmentLength);
      currentState = nextState;
      segmentStart = x;
    }
  }
  patterns.push(width - segmentStart);

  for (let i = 0; i < patterns.length - 4; i++) {
    const ratio = [patterns[i], patterns[i + 1], patterns[i + 2], patterns[i + 3], patterns[i + 4]];
    const total = ratio.reduce((a, b) => a + b, 0);
    if (total < 15 || total > 100) continue;

    const normalized = ratio.map(r => r / total);
    const expected = [0.1429, 0.1429, 0.4286, 0.1429, 0.1429];
    
    let error = 0;
    for (let j = 0; j < 5; j++) {
      error += Math.abs(normalized[j] - expected[j]);
    }

    if (error < 0.15) {
      const centerX = segmentStart + total / 2;
      return [centerX, y, total];
    }
  }

  return null;
}

function scanVerticalLine(data: Uint8ClampedArray, width: number, height: number, x: number, threshold: number): number[] | null {
  const patterns: number[] = [];
  let currentState = isDark(data, width, x, 0, threshold);
  let segmentStart = 0;

  for (let y = 1; y < height; y++) {
    const nextState = isDark(data, width, x, y, threshold);
    if (nextState !== currentState) {
      const segmentLength = y - segmentStart;
      patterns.push(segmentLength);
      currentState = nextState;
      segmentStart = y;
    }
  }
  patterns.push(height - segmentStart);

  for (let i = 0; i < patterns.length - 4; i++) {
    const ratio = [patterns[i], patterns[i + 1], patterns[i + 2], patterns[i + 3], patterns[i + 4]];
    const total = ratio.reduce((a, b) => a + b, 0);
    if (total < 15 || total > 100) continue;

    const normalized = ratio.map(r => r / total);
    const expected = [0.1429, 0.1429, 0.4286, 0.1429, 0.1429];
    
    let error = 0;
    for (let j = 0; j < 5; j++) {
      error += Math.abs(normalized[j] - expected[j]);
    }

    if (error < 0.15) {
      const centerY = segmentStart + total / 2;
      return [x, centerY, total];
    }
  }

  return null;
}

function findFinderPatterns(data: Uint8ClampedArray, width: number, height: number): FinderPattern[] {
  const patterns: FinderPattern[] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 100));
  const threshold = calculateAutoThreshold(data, width, height);

  for (let y = step; y < height - step; y += step) {
    const result = scanHorizontalLine(data, width, height, y, threshold);
    if (result) {
      const [centerX, centerY, size] = result;
      const verticalResult = scanVerticalLine(data, width, height, Math.floor(centerX), threshold);
      
      if (verticalResult && Math.abs(verticalResult[1] - centerY) < size) {
        let alreadyExists = false;
        for (const p of patterns) {
          const distance = Math.sqrt(Math.pow(p.center.x - centerX, 2) + Math.pow(p.center.y - centerY, 2));
          if (distance < size) {
            alreadyExists = true;
            if (size > p.size) {
              p.center = { x: centerX, y: centerY };
              p.size = size;
              p.strength += 1;
            }
            break;
          }
        }
        
        if (!alreadyExists) {
          patterns.push({
            center: { x: centerX, y: centerY },
            size,
            strength: 1
          });
        }
      }
    }
  }

  return patterns.sort((a, b) => b.strength - a.strength).slice(0, 3);
}

function calculateAutoThreshold(data: Uint8ClampedArray, width: number, height: number): number {
  let totalBrightness = 0;
  let count = 0;
  
  for (let y = 0; y < height; y += 10) {
    for (let x = 0; x < width; x += 10) {
      totalBrightness += getPixelBrightness(data, width, x, y);
      count++;
    }
  }
  
  return totalBrightness / count;
}

function calculateFourthCorner(fp1: FinderPattern, fp2: FinderPattern, fp3: FinderPattern): Point {
  const p1 = fp1.center;
  const p2 = fp2.center;
  const p3 = fp3.center;

  const d12 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  const d13 = Math.sqrt(Math.pow(p3.x - p1.x, 2) + Math.pow(p3.y - p1.y, 2));
  const d23 = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));

  let topLeft: Point, topRight: Point, bottomLeft: Point;

  if (d12 < d13 && d12 < d23) {
    topLeft = p1;
    topRight = p2;
    bottomLeft = p3;
  } else if (d13 < d12 && d13 < d23) {
    topLeft = p1;
    topRight = p3;
    bottomLeft = p2;
  } else {
    topLeft = p2;
    topRight = p3;
    bottomLeft = p1;
  }

  return {
    x: topRight.x + bottomLeft.x - topLeft.x,
    y: topRight.y + bottomLeft.y - topLeft.y
  };
}

function sortCorners(fps: FinderPattern[]): QRCodeCorners {
  const p1 = fps[0].center;
  const p2 = fps[1].center;
  const p3 = fps[2].center;
  const p4 = calculateFourthCorner(fps[0], fps[1], fps[2]);

  const points = [p1, p2, p3, p4];
  
  points.sort((a, b) => {
    if (Math.abs(a.y - b.y) < 50) return a.x - b.x;
    return a.y - b.y;
  });

  const topTwo = points.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottomTwo = points.slice(2, 4).sort((a, b) => a.x - b.x);

  const size = Math.max(fps[0].size, fps[1].size, fps[2].size);
  const offset = size / 2;

  return {
    topLeft: { x: topTwo[0].x - offset, y: topTwo[0].y - offset },
    topRight: { x: topTwo[1].x + offset, y: topTwo[1].y - offset },
    bottomLeft: { x: bottomTwo[0].x - offset, y: bottomTwo[0].y + offset },
    bottomRight: { x: bottomTwo[1].x + offset, y: bottomTwo[1].y + offset }
  };
}

export function detectFinderPatterns(canvas: HTMLCanvasElement): QRCodeCorners | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const patterns = findFinderPatterns(imageData.data, canvas.width, canvas.height);

  console.log('=== Finder Pattern Detection ===');
  console.log('Detected patterns:', patterns.length);
  patterns.forEach((p, i) => {
    console.log(`Pattern ${i + 1}: (${p.center.x.toFixed(1)}, ${p.center.y.toFixed(1)}), size: ${p.size}, strength: ${p.strength}`);
  });

  if (patterns.length >= 3) {
    const corners = sortCorners(patterns);
    console.log('Estimated corners:', corners);
    return corners;
  }

  console.log('Insufficient finder patterns detected');
  return null;
}