import { ref } from 'vue';
import type { ImageUploadResult, ImageUploadOptions } from '@/types';
import { generateId, validateImage, loadImage } from '@/utils/imageUtils';
export function useImageUpload() {
 const isUploading = ref(false);
 const error = ref<string | null>(null);
 const defaultOptions: ImageUploadOptions = {
 maxSize: 2048,
 allowedTypes: ['image/png', 'image/jpeg', 'image/webp']
 };
 async function upload(
 file: File,
 type: 'template' | 'qr',
 options?: ImageUploadOptions
 ): Promise<ImageUploadResult> {
 isUploading.value = true;
 error.value = null;
 try {
 const opts = { ...defaultOptions, ...options };
 const validation = validateImage(file, opts);
 if (!validation.valid) {
 throw new Error(validation.error || '图片验证失败');
 }
 const url = URL.createObjectURL(file);
 const img = await loadImage(url);
 if (img.width > opts.maxSize || img.height > opts.maxSize) {
 error.value = '图片尺寸过大，已自动缩放至2048px以内';
 }
 return {
 id: generateId(),
 file,
 url,
 width: img.width,
 height: img.height,
 type
 };
 }
 catch (err) {
 error.value = err instanceof Error ? err.message : '上传失败';
 throw err;
 }
 finally {
 isUploading.value = false;
 }
 }
 async function handleDrop(event: DragEvent): Promise<ImageUploadResult | null> {
 event.preventDefault();
 const files = event.dataTransfer?.files;
 if (!files || files.length === 0)
 return null;
 const file = files[0];
 if (!file.type.startsWith('image/'))
 return null;
 return upload(file, 'template');
 }
 async function handleFileSelect(event: Event): Promise<ImageUploadResult | null> {
 const target = event.target as HTMLInputElement;
 const files = target.files;
 if (!files || files.length === 0)
 return null;
 const file = files[0];
 return upload(file, 'template');
 }
 return {
 isUploading,
 error,
 upload,
 handleDrop,
 handleFileSelect
 };
}

