import * as UTIF from 'utif';
import type { Format, Settings, WorkerResult } from './types';

interface Job {
  id: string;
  file: File;
  format: Format;
  settings: Settings;
  maxBytes?: number;
}

const MAX_PIXELS = 120_000_000;

function firstNumber(value: unknown): number {
  return Array.isArray(value) ? Number(value[0]) : Number(value);
}

async function decode(file: File, format: Format): Promise<{ canvas: OffscreenCanvas; width: number; height: number; warning?: string }> {
  let canvas: OffscreenCanvas;
  let width: number;
  let height: number;

  if (format === 'TIFF') {
    const buffer = await file.arrayBuffer();
    const ifd = UTIF.decode(buffer)[0];
    if (!ifd) throw new Error('TIFF 没有可读取的第一页。');
    width = firstNumber(ifd.t256 ?? ifd.width);
    height = firstNumber(ifd.t257 ?? ifd.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) {
      throw new Error('图片尺寸超出浏览器可安全处理的范围，请使用桌面版转换。');
    }
    UTIF.decodeImage(buffer, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    if (rgba.length !== width * height * 4) throw new Error('TIFF 像素数据不完整。');
    const pixels = new OffscreenCanvas(width, height);
    const context = pixels.getContext('2d');
    if (!context) throw new Error('浏览器无法创建图片画布。');
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const orientation = firstNumber(ifd.t274 ?? 1);
    if (orientation >= 2 && orientation <= 8) {
      const rotated = orientation >= 5;
      canvas = new OffscreenCanvas(rotated ? height : width, rotated ? width : height);
      const output = canvas.getContext('2d');
      if (!output) throw new Error('浏览器无法创建图片画布。');
      const transforms: Record<number, [number, number, number, number, number, number]> = {
        2: [-1, 0, 0, 1, width, 0], 3: [-1, 0, 0, -1, width, height],
        4: [1, 0, 0, -1, 0, height], 5: [0, 1, 1, 0, 0, 0],
        6: [0, 1, -1, 0, height, 0], 7: [0, -1, -1, 0, height, width],
        8: [0, -1, 1, 0, 0, width],
      };
      output.setTransform(...transforms[orientation]);
      output.drawImage(pixels, 0, 0);
      pixels.width = 0;
      pixels.height = 0;
      if (rotated) [width, height] = [height, width];
    } else {
      canvas = pixels;
    }
  } else {
    const { heicTo } = await import('heic-to/next');
    const bitmap = await heicTo({ blob: file, type: 'bitmap' });
    try {
      width = bitmap.width;
      height = bitmap.height;
      if (width < 1 || height < 1 || width * height > MAX_PIXELS) {
        throw new Error('图片尺寸超出浏览器可安全处理的范围，请使用桌面版转换。');
      }
      canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建图片画布。');
      context.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
  }

  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建图片画布。');
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = 'source-over';
  return {
    canvas,
    width,
    height,
    warning: width > 12000 || height > 12000 ? '超大图片，处理可能需要较长时间。' : undefined,
  };
}

async function validateJpeg(blob: Blob, width: number, height: number, limit: number): Promise<void> {
  if (blob.type !== 'image/jpeg' || blob.size < 4 || blob.size >= limit) {
    throw new Error('JPEG 未通过大小或格式校验。');
  }
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const tail = new Uint8Array(await blob.slice(-2).arrayBuffer());
  if (head[0] !== 0xff || head[1] !== 0xd8 || tail[0] !== 0xff || tail[1] !== 0xd9) {
    throw new Error('JPEG 文件不完整。');
  }
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width !== width || bitmap.height !== height) throw new Error('JPEG 尺寸校验失败。');
  } finally {
    bitmap.close();
  }
}

async function convert(job: Job): Promise<WorkerResult> {
  const source = await decode(job.file, job.format);
  const limit = Math.min(Math.floor(job.settings.targetMb * 1_000_000), job.maxBytes ? job.maxBytes + 1 : Number.MAX_SAFE_INTEGER);
  if (limit < 1) throw new Error('目标大小无效。');
  let canvas = source.canvas;
  let width = source.width;
  let height = source.height;
  const maxQuality = Math.max(40, Math.min(100, Math.round(job.settings.quality)));

  try {
    for (let resize = 0; resize < 25; resize += 1) {
      for (let quality = maxQuality; quality >= 40; quality = Math.max(40, quality - 5)) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
        if (blob.size < limit) {
          await validateJpeg(blob, width, height, limit);
          return { id: job.id, blob, width, height, quality, warning: source.warning };
        }
        if (quality === 40) break;
      }
      const nextWidth = Math.max(1, Math.floor(width * 0.85));
      const nextHeight = Math.max(1, Math.floor(height * 0.85));
      if (nextWidth === width && nextHeight === height) break;
      const smaller = new OffscreenCanvas(nextWidth, nextHeight);
      const context = smaller.getContext('2d');
      if (!context) throw new Error('浏览器无法缩小图片。');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, nextWidth, nextHeight);
      context.drawImage(canvas, 0, 0, nextWidth, nextHeight);
      canvas.width = 0;
      canvas.height = 0;
      canvas = smaller;
      width = nextWidth;
      height = nextHeight;
    }
    throw new Error('无法压到目标大小以下，请提高目标大小。');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    source.canvas.width = 0;
    source.canvas.height = 0;
  }
}

self.onmessage = async (event: MessageEvent<Job>) => {
  try {
    const result = await convert(event.data);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
