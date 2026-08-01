import type { ConvertSettings } from './settings';

export interface ConvertJobRequest {
  id: string;
  inputPath: string;
  outputDirectory: string;
  suffix: string;
  settings: ConvertSettings;
}

export interface ConvertBatchRequest {
  jobs: ConvertJobRequest[];
  settings: ConvertSettings;
}

export interface ConvertEvent {
  id: string;
  status: 'queued' | 'converting' | 'compressing' | 'success' | 'failed' | 'cancelled';
  progress: number;
  outputPath?: string;
  outputSize?: number;
  error?: string;
}

export interface ConvertResult {
  id: string;
  inputPath: string;
  outputPath?: string;
  outputSize?: number;
  success: boolean;
  error?: string;
}

export interface PreviewRequest {
  id: string;
  inputPath: string;
  settings: ConvertSettings;
}

export interface PreviewResult {
  id: string;
  previewSize?: number;
  success: boolean;
  error?: string;
  warning?: string;
}
