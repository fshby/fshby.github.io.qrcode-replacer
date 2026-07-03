import { ref } from 'vue';
import type { ExportOptions } from '@/types';
export function useExport() {
 const isExporting = ref(false);
 const defaultOptions: ExportOptions = {
 format: 'png',
 quality: 0.92,
 filename: 'qrcode-replaced'
 };
 function download(
 canvas: HTMLCanvasElement,
 options?: ExportOptions
 ): void {
 isExporting.value = true;
 try {
 const opts = { ...defaultOptions, ...options };
 const mimeType = opts.format === 'png' ? 'image/png' : 'image/jpeg';
 const dataUrl = canvas.toDataURL(mimeType, opts.quality);
 const link = document.createElement('a');
 link.download = `${opts.filename}.${opts.format}`;
 link.href = dataUrl;
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 }
 catch (err) {
 throw err;
 }
 finally {
 isExporting.value = false;
 }
 }
 async function toBlob(
 canvas: HTMLCanvasElement,
 options?: ExportOptions
 ): Promise<Blob> {
 const opts = { ...defaultOptions, ...options };
 const mimeType = opts.format === 'png' ? 'image/png' : 'image/jpeg';
 return new Promise((resolve, reject) => {
 canvas.toBlob((blob) => {
 if (blob) {
 resolve(blob);
 }
 else {
 reject(new Error('导出失败'));
 }
 }, mimeType, opts.quality);
 });
 }
 function toDataURL(
 canvas: HTMLCanvasElement,
 options?: ExportOptions
 ): string {
 const opts = { ...defaultOptions, ...options };
 const mimeType = opts.format === 'png' ? 'image/png' : 'image/jpeg';
 return canvas.toDataURL(mimeType, opts.quality);
 }
 return {
 isExporting,
 download,
 toBlob,
 toDataURL
 };
}

