import { ref } from 'vue';
import jsQR from 'jsqr';
import type { QRDetectResult, QRCodeCorners, Point } from '@/types';
import { detectFinderPatterns } from '@/utils/finderPatternDetector';

export function useQRDetect() {
  const isDetecting = ref(false);
  const lastResult = ref<QRDetectResult | null>(null);

  function sortCorners(corners: Point[]): QRCodeCorners {
    const sorted = [...corners].sort((a, b) => {
      if (Math.abs(a.y - b.y) < 10) return a.x - b.x;
      return a.y - b.y;
    });
    const topTwo = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottomTwo = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
    return {
      topLeft: topTwo[0],
      topRight: topTwo[1],
      bottomLeft: bottomTwo[0],
      bottomRight: bottomTwo[1]
    };
  }

  async function detect(canvas: HTMLCanvasElement): Promise<QRDetectResult> {
    isDetecting.value = true;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return { success: false, error: '无法获取Canvas上下文' };
      }

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });

      if (code) {
        const allCorners: Point[] = [
          { x: code.location.topLeftCorner.x, y: code.location.topLeftCorner.y },
          { x: code.location.topRightCorner.x, y: code.location.topRightCorner.y },
          { x: code.location.bottomLeftCorner.x, y: code.location.bottomLeftCorner.y },
          { x: code.location.bottomRightCorner.x, y: code.location.bottomRightCorner.y }
        ];
        const corners = sortCorners(allCorners);
        console.log('QR Code detected:', {
          data: code.data,
          rawCorners: allCorners,
          sortedCorners: corners,
          canvasSize: { width: canvas.width, height: canvas.height }
        });

        const result: QRDetectResult = {
          success: true,
          corners,
          data: code.data
        };
        lastResult.value = result;
        return result;
      }

      console.log('jsQR detection failed, trying finder pattern detection...');
      const fallbackCorners = detectFinderPatterns(canvas);

      if (fallbackCorners) {
        console.log('Finder pattern detection succeeded:', fallbackCorners);
        const result: QRDetectResult = {
          success: true,
          corners: fallbackCorners,
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

