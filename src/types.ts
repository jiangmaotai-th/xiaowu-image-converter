export type SourceFormat = 'TIFF' | 'PSD';

export type ConvertStatus = 'queued' | 'processing' | 'done' | 'error';

export interface ImageJob {
  id: string;
  file: File;
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
  options: ConvertOptions;
}

export interface WorkerSuccess {
  type: 'success';
  id: string;
  blob: Blob;
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
