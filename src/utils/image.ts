import type { SourceFormat } from '../types';

export function getSourceFormat(file: File): SourceFormat | null {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'TIFF';
  if (lower.endsWith('.psd')) return 'PSD';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'JPG';
  return null;
}

export function toJpegName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpeg';
}

export function makeId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}
