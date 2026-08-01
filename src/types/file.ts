export type InputFormat =
  | 'PSD'
  | 'PSB'
  | 'TIFF'
  | 'PNG'
  | 'JPG'
  | 'HEIC'
  | 'WEBP'
  | 'BMP';

export type FileStatus =
  | 'queued'
  | 'converting'
  | 'compressing'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface AppFile {
  id: string;
  path: string;
  name: string;
  format: InputFormat;
  originalSize: number;
  outputSize?: number;
  previewSize?: number;
  previewPending?: boolean;
  previewError?: string;
  previewWarning?: string;
  status: FileStatus;
  progress: number;
  error?: string;
  outputPath?: string;
}

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  is_file: boolean;
}
