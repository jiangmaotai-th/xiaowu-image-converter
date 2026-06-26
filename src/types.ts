export type SourceFormat = 'TIFF' | 'PSD' | 'JPG' | 'HEIC';

export type ConvertStatus = 'queued' | 'processing' | 'done' | 'error';

export interface ImageJob {
  id: string;
  file?: File;
  name: string;
  originalSize: number;
  format: SourceFormat;
  status: ConvertStatus;
  progress: number;
  width?: number;
  height?: number;
  outputSize?: number;
  outputName?: string;
  outputBlob?: Blob;
  downloaded?: boolean;
  previewSize?: number;
  previewQuality?: number;
  previewBlob?: Blob;
  previewKey?: string;
  previewTargetKey?: string;
  previewRequestedQuality?: number;
  previewPending?: boolean;
  qualityUsed?: number;
  warning?: string;
  error?: string;
}

export interface ConvertOptions {
  quality: number;
  targetSizeMb: number;
  minAutoQuality: number;
  backgroundColor: string;
}

export interface WorkerRequest {
  id: string;
  file: File;
  format: SourceFormat;
  options: ConvertOptions;
  mode: 'preview' | 'convert';
}

export interface WorkerSuccess {
  type: 'success';
  id: string;
  blob?: Blob;
  outputName: string;
  width: number;
  height: number;
  outputSize: number;
  qualityUsed: number;
  warning?: string;
}

export interface WorkerFailure {
  type: 'error';
  id: string;
  error: string;
}

export type WorkerResponse = WorkerSuccess | WorkerFailure;
