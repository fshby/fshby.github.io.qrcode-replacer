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

      console.log('jsQR detection failed, trying image feature based detection...');
      const fallbackCorners = detectQRCornersByImageFeatures(canvas);

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

      // 最后兜底：旧版 finder pattern 检测
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

