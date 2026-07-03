import { reactive } from 'vue';
import type { AppState, ImageUploadResult, QRCodeCorners, SelectionArea, HistoryEntry } from '@/types';
const state = reactive<AppState>({
 templateImage: null,
 qrImage: null,
 qrContent: '',
 qrCorners: null,
 selectionArea: null,
 isDetecting: false,
 isCompositing: false,
 error: null,
 history: []
});
const subscribers: ((state: AppState) => void)[] = [];
function saveToHistory(): void {
 const entry: HistoryEntry = {
 state: {
 templateImage: state.templateImage,
 qrImage: state.qrImage,
 qrCorners: state.qrCorners ? { ...state.qrCorners } : null,
 selectionArea: state.selectionArea ? {
 anchors: [...state.selectionArea.anchors],
 bounds: { ...state.selectionArea.bounds }
 } : null
 },
 timestamp: Date.now()
 };
 state.history.push(entry);
 if (state.history.length > 50) {
 state.history.shift();
 }
}
export function useAppStore() {
 function subscribe(callback: (state: AppState) => void): () => void {
 subscribers.push(callback);
 return () => {
 const index = subscribers.indexOf(callback);
 if (index > -1) {
 subscribers.splice(index, 1);
 }
 };
 }
 function notify(): void {
 subscribers.forEach(callback => callback({ ...state }));
 }
 function setTemplateImage(image: ImageUploadResult): void {
 saveToHistory();
 state.templateImage = image;
 state.error = null;
 notify();
 }
 function setQRImage(image: ImageUploadResult): void {
 saveToHistory();
 state.qrImage = image;
 state.error = null;
 notify();
 }
 function setQRContent(content: string): void {
 saveToHistory();
 state.qrContent = content;
 notify();
 }
 function setQRCorners(corners: QRCodeCorners): void {
 saveToHistory();
 state.qrCorners = corners;
 notify();
 }
 function setSelectionArea(area: SelectionArea): void {
 state.selectionArea = area;
 notify();
 }
 function setIsDetecting(value: boolean): void {
 state.isDetecting = value;
 notify();
 }
 function setIsCompositing(value: boolean): void {
 state.isCompositing = value;
 notify();
 }
 function setError(error: string | null): void {
  state.error = error;
  notify();
}
function clearError(): void {
  state.error = null;
  notify();
}
 function undo(): void {
 if (state.history.length === 0)
 return;
 const lastEntry = state.history.pop()!;
 if (lastEntry.state.templateImage !== undefined)
 state.templateImage = lastEntry.state.templateImage;
 if (lastEntry.state.qrImage !== undefined)
 state.qrImage = lastEntry.state.qrImage;
 if (lastEntry.state.qrCorners !== undefined)
 state.qrCorners = lastEntry.state.qrCorners;
 if (lastEntry.state.selectionArea !== undefined)
 state.selectionArea = lastEntry.state.selectionArea;
 state.error = null;
 notify();
 }
 function reset(): void {
 saveToHistory();
 state.templateImage = null;
 state.qrImage = null;
 state.qrCorners = null;
 state.selectionArea = null;
 state.isDetecting = false;
 state.isCompositing = false;
 state.error = null;
 notify();
 }
 return {
  state,
  subscribe,
  setTemplateImage,
  setQRImage,
  setQRContent,
  setQRCorners,
  setSelectionArea,
  setIsDetecting,
  setIsCompositing,
  setError,
  clearError,
  undo,
  reset
};
}

