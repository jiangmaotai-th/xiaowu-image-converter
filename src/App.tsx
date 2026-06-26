import { useMemo, useRef, useState } from 'react';

import DropZone from './components/DropZone';
import FileList from './components/FileList';
import Toolbar from './components/Toolbar';
import type { ConvertOptions, ImageJob, WorkerFailure, WorkerResponse } from './types';
import { downloadBlob } from './utils/download';
import { getSourceFormat, makeId } from './utils/image';
import { runWithConcurrency } from './utils/queue';

const CONCURRENCY = 2;
const MIN_AUTO_QUALITY = 0.65;
const VISIBLE_ROWS = 500;

export default function App() {
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [jobsById, setJobsById] = useState<Record<string, ImageJob>>({});
  const [quality, setQuality] = useState(1);
  const [targetSizeMb, setTargetSizeMb] = useState(10);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const workersRef = useRef<Worker[]>([]);

  const jobs = useMemo(() => jobIds.map((id) => jobsById[id]).filter(Boolean), [jobIds, jobsById]);
  const visibleJobs = useMemo(() => jobs.slice(-VISIBLE_ROWS), [jobs]);
  const canConvert = useMemo(() => jobs.some((job) => job.file && (job.status === 'queued' || job.status === 'error')), [jobs]);
  const convertLabel = busy ? '转换中' : '转换';

  const updateJob = (id: string, patch: Partial<ImageJob>) => {
    setJobsById((current) => {
      const job = current[id];
      if (!job) return current;
      return { ...current, [id]: { ...job, ...patch } };
    });
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
      setJobIds((current) => [...current, ...accepted.map((job) => job.id)]);
      setJobsById((current) => {
        const next = { ...current };
        for (const job of accepted) {
          next[job.id] = job;
        }
        return next;
      });
    }
    setMessages([
      ...rejected,
      ...(accepted.length > 100
        ? [`已加入 ${accepted.length} 个文件。建议一次转换 20-100 张；更大批量也会排队逐个处理，避免一次性解码进内存。`]
        : []),
    ]);
  };

  const convertOne = (job: ImageJob, options: ConvertOptions) =>
    new Promise<WorkerResponse>((resolve) => {
      if (!job.file) {
        const data: WorkerFailure = {
          type: 'error',
          id: job.id,
          error: '文件已释放，请重新上传后再转换',
        };
        updateJob(job.id, { status: 'error', progress: 0, error: data.error });
        resolve(data);
        return;
      }

      updateJob(job.id, {
        status: 'processing',
        progress: 18,
        error: undefined,
        warning: undefined,
        outputBlob: undefined,
        outputSize: undefined,
        outputName: undefined,
        downloaded: false,
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
    const targets = jobs.filter((job) => job.file && (job.status === 'queued' || job.status === 'error'));
    if (targets.length === 0) return;

    setBusy(true);
    setMessages([]);
    let downloadCount = 0;

    const options: ConvertOptions = {
      quality,
      targetSizeMb,
      minAutoQuality: MIN_AUTO_QUALITY,
      backgroundColor: '#ffffff',
    };

    await runWithConcurrency(targets, CONCURRENCY, async (job) => {
      const result = await convertOne(job, options);
      if (result.type === 'success') {
        downloadBlob(result.blob, result.outputName);
        downloadCount += 1;
        updateJob(result.id, {
          file: undefined,
          outputBlob: undefined,
          downloaded: true,
        });
      }
    });

    setMessages(
      downloadCount > 0
        ? [`转换完成，已直接下载 ${downloadCount} 个 JPEG 文件。`]
        : ['没有成功转换的文件，请查看列表中的错误提示。'],
    );
    setBusy(false);
  };

  const clearAll = () => {
    for (const worker of workersRef.current) {
      worker.terminate();
    }
    workersRef.current = [];
    setJobIds([]);
    setJobsById({});
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
        <div className="privacy-pill">开发者：猫汰&nbsp;&nbsp;版本 v1.0</div>
      </header>

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

      <FileList jobs={visibleJobs} totalCount={jobIds.length} />
    </main>
  );
}
