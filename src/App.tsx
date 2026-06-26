import { useMemo, useRef, useState } from 'react';

import DropZone from './components/DropZone';
import FileList from './components/FileList';
import Toolbar from './components/Toolbar';
import type { ConvertOptions, ImageJob, WorkerResponse } from './types';
import { downloadBlob } from './utils/download';
import { getSourceFormat, makeId } from './utils/image';
import { runWithConcurrency } from './utils/queue';

const CONCURRENCY = 2;
const MIN_AUTO_QUALITY = 0.65;

export default function App() {
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [quality, setQuality] = useState(0.92);
  const [targetSizeMb, setTargetSizeMb] = useState(10);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const workersRef = useRef<Worker[]>([]);

  const canConvert = useMemo(
    () => jobs.length > 0,
    [jobs],
  );
  const convertLabel = useMemo(
    () => (jobs.some((job) => job.status === 'done') ? '重新转换' : '转换'),
    [jobs],
  );

  const updateJob = (id: string, patch: Partial<ImageJob>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  };

  const addFiles = (files: File[]) => {
    const accepted: ImageJob[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      const format = getSourceFormat(file);
      if (!format) {
        rejected.push(`${file.name} 不是支持的 TIFF / PSD 文件`);
        continue;
      }

      accepted.push({
        id: makeId(file),
        file,
        name: file.name,
        originalSize: file.size,
        format,
        status: 'queued',
        progress: 0,
      });
    }

    if (accepted.length > 0) {
      setJobs((current) => [...current, ...accepted]);
    }
    setMessages(rejected);
  };

  const convertOne = (job: ImageJob, options: ConvertOptions) =>
    new Promise<WorkerResponse>((resolve) => {
      updateJob(job.id, {
        status: 'processing',
        progress: 18,
        error: undefined,
        warning: undefined,
        outputBlob: undefined,
        outputSize: undefined,
        outputName: undefined,
      });

      const worker = new Worker(new URL('./workers/convertWorker.ts', import.meta.url), {
        type: 'module',
      });
      workersRef.current.push(worker);

      const cleanup = () => {
        worker.terminate();
        workersRef.current = workersRef.current.filter((item) => item !== worker);
      };

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        if (data.type === 'success') {
          updateJob(data.id, {
            status: 'done',
            progress: 100,
            width: data.width,
            height: data.height,
            outputBlob: data.blob,
            outputName: data.outputName,
            outputSize: data.outputSize,
            qualityUsed: data.qualityUsed,
            warning: data.warning,
          });
        } else {
          updateJob(data.id, {
            status: 'error',
            progress: 0,
            error: data.error,
          });
        }
        cleanup();
        resolve(data);
      };

      worker.onerror = (event) => {
        const data: WorkerResponse = {
          type: 'error',
          id: job.id,
          error: event.message || 'Worker 转换出错',
        };
        updateJob(job.id, {
          status: 'error',
          progress: 0,
          error: data.error,
        });
        cleanup();
        resolve(data);
      };

      worker.postMessage({
        id: job.id,
        file: job.file,
        options,
      });
    });

  const convertAll = async () => {
    const pending = jobs.filter((job) => job.status === 'queued' || job.status === 'error');
    const targets = pending.length > 0 ? pending : jobs;
    if (targets.length === 0) return;

    setBusy(true);
    setMessages([]);
    const downloads: Array<{ blob: Blob; name: string }> = [];

    const options: ConvertOptions = {
      quality,
      targetSizeMb,
      minAutoQuality: MIN_AUTO_QUALITY,
      backgroundColor: '#ffffff',
    };

    await runWithConcurrency(targets, CONCURRENCY, async (job) => {
      const result = await convertOne(job, options);
      if (result.type === 'success') {
        downloads.push({ blob: result.blob, name: result.outputName });
      }
    });

    for (const item of downloads) {
      downloadBlob(item.blob, item.name);
    }

    setMessages(
      downloads.length > 0
        ? [`转换完成，已直接下载 ${downloads.length} 个 JPEG 文件。`]
        : ['没有成功转换的文件，请查看列表中的错误提示。'],
    );
    setBusy(false);
  };

  const clearAll = () => {
    for (const worker of workersRef.current) {
      worker.terminate();
    }
    workersRef.current = [];
    setJobs([]);
    setMessages([]);
    setBusy(false);
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">本地批量 TIFF / PSD 转 JPEG</p>
          <h1>小午的图片转换</h1>
        </div>
        <div className="privacy-pill">不上传服务器</div>
      </header>

      <section className="notice-grid">
        <p>JPEG 是有损压缩格式，不是真正无损。</p>
        <p>所有转换都在本地浏览器完成，不上传服务器。</p>
        <p>PSD 会按当前可见合成效果导出为 JPEG。</p>
      </section>

      <DropZone disabled={busy} onFiles={addFiles} />

      <Toolbar
        quality={quality}
        targetSizeMb={targetSizeMb}
        disabled={busy}
        canConvert={canConvert}
        convertLabel={convertLabel}
        onQualityChange={setQuality}
        onTargetSizeChange={setTargetSizeMb}
        onConvert={convertAll}
        onClear={clearAll}
      />

      {messages.length > 0 && (
        <section className="message-panel">
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </section>
      )}

      <FileList jobs={jobs} onDownload={(job) => job.outputBlob && downloadBlob(job.outputBlob, job.outputName ?? 'image.jpeg')} />
    </main>
  );
}
