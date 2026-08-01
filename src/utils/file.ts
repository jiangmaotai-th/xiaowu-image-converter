import type { InputFormat } from '../types/file';

const formatMap: Record<string, InputFormat> = {
  psd: 'PSD',
  psb: 'PSB',
  tif: 'TIFF',
  tiff: 'TIFF',
  png: 'PNG',
  jpg: 'JPG',
  jpeg: 'JPG',
  heic: 'HEIC',
  webp: 'WEBP',
  bmp: 'BMP',
};

export function getFormat(pathOrName: string): InputFormat | null {
  const extension = pathOrName.split('.').pop()?.toLowerCase() ?? '';
  return formatMap[extension] ?? null;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function makeFileId(path: string): string {
  return `${path}-${crypto.randomUUID()}`;
}
