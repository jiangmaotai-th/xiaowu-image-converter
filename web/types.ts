export type Format = 'TIFF' | 'HEIC';
export type FileStatus = 'waiting' | 'previewing' | 'ready' | 'converting' | 'done' | 'failed' | 'canceled';

export interface ImageRow {
  id: string;
  file: File | null;
  name: string;
  outputName: string;
  format: Format;
  inputSize: number;
  outputSize?: number;
  width?: number;
  height?: number;
  status: FileStatus;
  error?: string;
  warning?: string;
  previewCap?: number;
}

export interface Settings {
  quality: number;
  targetMb: number;
}

export interface WorkerResult {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  quality: number;
  warning?: string;
}
