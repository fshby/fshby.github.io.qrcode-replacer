import { ref } from 'vue';
import type { Point, ImageUploadResult } from '@/types';
import { compositeImage } from '@/utils/perspectiveUtils';
import { loadImage, resizeImage } from '@/utils/imageUtils';
export function usePerspectiveTransform() {
 const isTransforming = ref(false);
 const progress = ref(0);
 async function transform(
 templateCanvas: HTMLCanvasElement,
 qrImageResult: ImageUploadResult,
 dstCorners: Point[]
 ): Promise<void> {
 isTransforming.value = true;
 progress.value = 0;
 try {
 const qrImage = await loadImage(qrImageResult.url);
    const resizedQrImage = await resizeImage(qrImage, 2048);
 progress.value = 50;
 compositeImage(templateCanvas, resizedQrImage, dstCorners);
 progress.value = 100;
 }
 catch (err) {
 throw err;
 }
 finally {
 isTransforming.value = false;
 }
 }
 return {
 isTransforming,
 progress,
 transform
 };
}

