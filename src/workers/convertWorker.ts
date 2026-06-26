import { initializeCanvas, readPsd } from 'ag-psd';
import * as UTIF from 'utif';

import type { ConvertOptions, WorkerRequest, WorkerResponse } from '../types';
import { toJpegName } from '../utils/image';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

initializeCanvas(
  ((width: number, height: number) => new OffscreenCanvas(width, height)) as never,
  undefined,
  (width: number, height: number) => new ImageData(width, height),
);

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, file, format, options, mode } = event.data;

  try {
    const result = await convertFile(file, format, options);
    ctx.postMessage({
      type: 'success',
      id,
      ...result,
    } satisfies WorkerResponse);
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      id,
      error: error instanceof Error ? error.message : '转换失败',
    } satisfies WorkerResponse);
  }
};

async function convertFile(file: File, format: WorkerRequest['format'], options: ConvertOptions) {
  const buffer = await file.arrayBuffer();
  const image = await decodeImage(buffer, format);

  const warningParts: string[] = [];
  if (image.width > 12000 || image.height > 12000) {
    warningParts.push('图片尺寸超过 12000px，转换可能较慢');
  }
  if (image.warning) {
    warningParts.push(image.warning);
  }

  const { blob, qualityUsed, sizeWarning } = await encodeJpegUnderTarget(image, options);
  image.dispose?.();

  if (sizeWarning) {
    warningParts.push(sizeWarning);
  }

  return {
    blob,
    outputName: toJpegName(file.name),
    width: image.width,
    height: image.height,
    outputSize: blob.size,
    qualityUsed,
    warning: warningParts.join('；') || undefined,
  };
}

async function decodeImage(buffer: ArrayBuffer, format: WorkerRequest['format']): Promise<DecodedImage> {
  if (format === 'PSD') {
    return decodePsd(buffer);
  }

  if (format === 'JPG') {
    return decodeBrowserImage(buffer, 'image/jpeg');
  }

  if (format === 'HEIC') {
    return decodeBrowserImage(buffer, 'image/heic');
  }

  return decodeTiffWithFallback(buffer);
}

interface DecodedImage {
  width: number;
  height: number;
  imageData?: ImageData;
  canvas?: OffscreenCanvas;
  warning?: string;
  dispose?: () => void;
}

function decodeTiff(buffer: ArrayBuffer): DecodedImage {
  const pages = UTIF.decode(buffer);
  const firstPage = pages[0];
  if (!firstPage) {
    throw new Error('无法读取 TIFF 文件');
  }

  UTIF.decodeImage(buffer, firstPage);
  const rgba = UTIF.toRGBA8(firstPage);
  const width = Number(firstPage.width ?? firstPage.t256?.[0]);
  const height = Number(firstPage.height ?? firstPage.t257?.[0]);

  if (!width || !height) {
    throw new Error('无法识别 TIFF 图片尺寸');
  }

  return {
    width,
    height,
    imageData: new ImageData(new Uint8ClampedArray(rgba), width, height),
    warning: pages.length > 1 ? '多页 TIFF 已转换第一页' : undefined,
  };
}

async function decodeTiffWithFallback(buffer: ArrayBuffer): Promise<DecodedImage> {
  try {
    return await decodeBrowserImage(buffer, 'image/tiff');
  } catch {
    return decodeTiff(buffer);
  }
}

async function decodeBrowserImage(buffer: ArrayBuffer, type: string): Promise<DecodedImage> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type }));
  } catch {
    throw new Error(type === 'image/heic' ? '当前浏览器不支持 HEIC 解码，请先在 Mac/iPhone 导出为 JPG 后再转换' : '当前浏览器不支持 JPG 解码');
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const canvasCtx = canvas.getContext('2d');

  if (!canvasCtx) {
    bitmap.close();
    throw new Error('当前浏览器不支持 JPG 解码');
  }

  const width = bitmap.width;
  const height = bitmap.height;
  canvasCtx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return { width, height, canvas };
}

function decodePsd(buffer: ArrayBuffer): DecodedImage {
  const psd = readPsd(buffer, {
    useImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
  }) as {
    width: number;
    height: number;
    imageData?: ImageData;
    canvas?: OffscreenCanvas;
  };

  if (!psd.width || !psd.height) {
    throw new Error('无法识别 PSD 图片尺寸');
  }

  if (psd.imageData) {
    return {
      width: psd.width,
      height: psd.height,
      imageData: normalizeImageData(psd.imageData, psd.width, psd.height),
    };
  }

  if (psd.canvas) {
    const canvasCtx = psd.canvas.getContext('2d');
    const imageData = canvasCtx?.getImageData(0, 0, psd.width, psd.height);
    if (imageData) {
      return { width: psd.width, height: psd.height, imageData };
    }
  }

  throw new Error('PSD 没有可导出的合成图层');
}

async function encodeJpegUnderTarget(image: DecodedImage, options: ConvertOptions) {
  const targetBytes = options.targetSizeMb * 1024 * 1024;
  const canvas = new OffscreenCanvas(image.width, image.height);
  const canvasCtx = canvas.getContext('2d', { willReadFrequently: false });

  if (!canvasCtx) {
    throw new Error('当前浏览器不支持 Worker 画布转换');
  }

  const sourceCanvas = image.canvas ?? new OffscreenCanvas(image.width, image.height);
  if (image.imageData) {
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: false });
    if (!sourceCtx) {
      throw new Error('当前浏览器不支持 Worker 画布转换');
    }
    sourceCtx.putImageData(image.imageData, 0, 0);
  }

  canvasCtx.fillStyle = options.backgroundColor;
  canvasCtx.fillRect(0, 0, image.width, image.height);
  canvasCtx.drawImage(sourceCanvas, 0, 0);

  let quality = clampQuality(options.quality);
  let blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });

  if (blob.size > targetBytes && quality > options.minAutoQuality) {
    const minQuality = Math.max(0.4, options.minAutoQuality);
    const minBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: minQuality });

    if (minBlob.size <= targetBytes) {
      let low = minQuality;
      let high = quality;
      let bestBlob = minBlob;
      let bestQuality = minQuality;

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const nextQuality = Number(((low + high) / 2).toFixed(3));
        const nextBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: nextQuality });

        if (nextBlob.size <= targetBytes) {
          low = nextQuality;
          bestBlob = nextBlob;
          bestQuality = nextQuality;
        } else {
          high = nextQuality;
        }
      }

      blob = bestBlob;
      quality = bestQuality;
    } else {
      blob = minBlob;
      quality = minQuality;
    }
  }

  return {
    blob,
    qualityUsed: quality,
    sizeWarning:
      blob.size > targetBytes
        ? '需要降低尺寸或继续降低质量'
        : undefined,
  };
}

function clampQuality(value: number): number {
  return Math.min(1, Math.max(0.4, value));
}

function normalizeImageData(source: ImageData, width: number, height: number): ImageData {
  if (source.data instanceof Uint8ClampedArray) {
    return source;
  }

  const data = source.data as unknown as Uint16Array | Float32Array;
  const normalized = new Uint8ClampedArray(width * height * 4);
  const isFloat = data instanceof Float32Array;

  for (let index = 0; index < normalized.length; index += 1) {
    normalized[index] = isFloat ? clampByte(data[index] * 255) : clampByte((data[index] / 65535) * 255);
  }

  return new ImageData(normalized, width, height);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
