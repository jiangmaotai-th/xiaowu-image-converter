export type ConvertMode = 'auto' | 'photoshop' | 'imagemagick';

export interface ConvertSettings {
  outputFormat: 'JPEG';
  targetSizeMb: number;
  jpegQuality: number;
  minQuality: number;
  mode: ConvertMode;
  outputDirectory: string;
  filenameSuffix: string;
  concurrency: 1 | 2 | 3 | 4;
  allowResize: boolean;
}

export interface ToolStatus {
  photoshopAvailable: boolean;
  photoshopAppName?: string;
  photoshopVersion?: string;
  photoshopPath?: string;
  imagemagickAvailable: boolean;
  imagemagickVersion?: string;
}
