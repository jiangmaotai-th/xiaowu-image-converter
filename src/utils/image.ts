import type { SourceFormat } from '../types';

export function getSourceFormat(file: File): SourceFormat | null {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'TIFF';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'JPG';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'HEIC';
  return null;
}

export async function detectSourceFormat(file: File): Promise<SourceFormat | null> {
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const ascii = Array.from(header)
    .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
    .join('');

  if (header[0] === 0xff && header[1] === 0xd8) return 'JPG';
  if (
    (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2a && header[3] === 0x00) ||
    (header[0] === 0x4d && header[1] === 0x4d && header[2] === 0x00 && header[3] === 0x2a)
  ) {
    return 'TIFF';
  }
  if (ascii.includes('ftypheic') || ascii.includes('ftypheix') || ascii.includes('ftyphevc') || ascii.includes('ftyphevx') || ascii.includes('ftypmif1') || ascii.includes('ftypmsf1')) {
    return 'HEIC';
  }

  return getSourceFormat(file);
}

export function toJpegName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpeg';
}

export function makeId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}
