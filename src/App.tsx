import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useMemo, useRef, useState } from 'react';

import DropZone from './components/DropZone';
import FileList from './components/FileList';
import SettingsPanel from './components/SettingsPanel';
import Toolbar from './components/Toolbar';
import type { ConvertBatchRequest, ConvertEvent, ConvertJobRequest, ConvertResult, PreviewRequest, PreviewResult } from './types/convert';
import type { AppFile, FileInfo, FileStatus } from './types/file';
import type { ConvertSettings, ToolStatus } from './types/settings';
import { basename, getFormat, makeFileId } from './utils/file';

const defaultSettings: ConvertSettings = {
  outputFormat: 'JPEG',
  targetSizeMb: 10,
  jpegQuality: 92,
  minQuality: 65,
  mode: 'auto',
  outputDirectory: '',
  filenameSuffix: '_converted',
  concurrency: 2,
  allowResize: false,
};

const MAX_PREVIEW_BATCH = 24;
const MAX_VISIBLE_HISTORY = 600;

export default function App() {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [settings, setSettings] = useState<ConvertSettings>(defaultSettings);
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [installingImageMagick, setInstallingImageMagick] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const cancelRequestedRef = useRef(false);
  const previewRunRef = useRef(0);

  const queuedCount = useMemo(() => files.filter((file) => file.status === 'queued' || file.status === 'failed').length, [files]);
  const canStart = queuedCount > 0 && Boolean(settings.outputDirectory);

  useEffect(() => {
    void refreshToolStatus();

    const unlistenProgress = listen<ConvertEvent>('convert-progress', (event) => {
      applyConvertEvent(event.payload);
    });

    const unlistenDrop = listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
      void addPaths(event.payload.paths);
    });

    return () => {
      void unlistenProgress.then((dispose) => dispose());
      void unlistenDrop.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const previewableFiles = files
      .filter((file) => file.status === 'queued' || file.status === 'failed')
      .slice(-MAX_PREVIEW_BATCH);
    if (previewableFiles.length === 0) return;

    const runId = previewRunRef.current + 1;
    previewRunRef.current = runId;

    setFiles((current) =>
      current.map((file) =>
        file.status === 'queued' || file.status === 'failed'
          ? { ...file, previewPending: true, previewError: undefined }
          : file,
      ),
    );

    const timer = window.setTimeout(() => {
      void refreshPreviewSizes(runId, previewableFiles);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [files.map((file) => `${file.id}:${file.status}`).join('|'), settings.jpegQuality, settings.targetSizeMb, settings.allowResize]);

  const refreshToolStatus = async () => {
    try {
      const status = await invoke<ToolStatus>('detect_tools');
      setToolStatus(status);
      setMessages((current) => {
        const next = [...current];
        if (!status.imagemagickAvailable) {
          next.push('未检测到 ImageMagick。PSD/TIFF 快速转换需要安装 ImageMagick：brew install imagemagick');
        }
        if (!status.photoshopAvailable) {
          next.push('未检测到 Photoshop。PSD 高保真模式将不可用。');
        }
        return Array.from(new Set(next)).slice(-4);
      });
    } catch (error) {
      setMessages([`检测工具失败：${String(error)}`]);
    }
  };

  const applyConvertEvent = (event: ConvertEvent) => {
    setFiles((current) =>
      current.map((file) =>
        file.id === event.id
          ? {
              ...file,
              status: event.status as FileStatus,
              progress: event.progress,
              outputPath: event.outputPath ?? file.outputPath,
              outputSize: event.outputSize ?? file.outputSize,
              previewPending: event.status === 'success' ? false : file.previewPending,
              error: event.error,
            }
          : file,
      ),
    );
  };

  const refreshPreviewSizes = async (runId: number, previewableFiles: AppFile[]) => {
    const requests: PreviewRequest[] = previewableFiles.map((file) => ({
      id: file.id,
      inputPath: file.path,
      settings,
    }));

    try {
      const results = await invoke<PreviewResult[]>('preview_sizes', { requests });
      if (previewRunRef.current !== runId) return;

      setFiles((current) =>
        current.map((file) => {
          const result = results.find((item) => item.id === file.id);
          if (!result) return file;
          return {
            ...file,
            previewSize: result.previewSize,
            previewPending: false,
            previewError: result.success ? undefined : result.error,
            previewWarning: result.warning,
          };
        }),
      );
    } catch (error) {
      if (previewRunRef.current !== runId) return;
      setFiles((current) =>
        current.map((file) =>
          previewableFiles.some((previewFile) => previewFile.id === file.id)
            ? { ...file, previewPending: false, previewError: String(error) }
            : file,
        ),
      );
    }
  };

  const addPaths = async (paths: string[]) => {
    if (paths.length === 0) return;

    try {
      const infos = await invoke<FileInfo[]>('collect_input_paths', { paths });
      const accepted: AppFile[] = [];
      const rejected: string[] = [];

      for (const info of infos) {
        const format = getFormat(info.path);
        if (!info.is_file || !format) {
          rejected.push(`${info.name} 不是支持的图片格式`);
          continue;
        }

        accepted.push({
          id: makeFileId(info.path),
          path: info.path,
          name: info.name || basename(info.path),
          format,
          originalSize: info.size,
          status: 'queued',
          progress: 0,
        });
      }

      setFiles((current) => {
        const existing = new Set(current.map((file) => file.path));
        return [...current, ...accepted.filter((file) => !existing.has(file.path))];
      });

      setMessages([
        ...(accepted.length > 0 ? [`已加入 ${accepted.length} 个文件。`] : []),
        ...rejected.slice(0, 5),
      ]);
    } catch (error) {
      setMessages([`读取文件失败：${String(error)}`]);
    }
  };

  const startConvert = async () => {
    if (!canStart || busy) return;
    cancelRequestedRef.current = false;
    setBusy(true);
    setMessages([]);

    setFiles((current) =>
      current.map((file) =>
        file.status === 'failed' || file.status === 'queued'
          ? { ...file, status: 'queued', progress: 0, error: undefined, outputPath: undefined, outputSize: undefined }
          : file,
      ),
    );

    const jobs: ConvertJobRequest[] = files
      .filter((file) => file.status === 'queued' || file.status === 'failed')
      .map((file) => ({
        id: file.id,
        inputPath: file.path,
        outputDirectory: settings.outputDirectory,
        suffix: settings.filenameSuffix,
        settings,
      }));

    try {
      const request: ConvertBatchRequest = { jobs, settings };
      const results = await invoke<ConvertResult[]>('convert_batch', { request });
      const failed = results.filter((result) => !result.success).length;
      const success = results.length - failed;
      setFiles((current) => compactCompletedFiles(current));
      setMessages([`转换完成：成功 ${success} 个，失败 ${failed} 个。`]);
    } catch (error) {
      setMessages([`转换中断：${String(error)}`]);
    } finally {
      setBusy(false);
    }
  };

  const cancelConvert = async () => {
    cancelRequestedRef.current = true;
    await invoke('cancel_conversion');
    setFiles((current) =>
      current.map((file) =>
        file.status === 'queued' || file.status === 'converting' || file.status === 'compressing'
          ? { ...file, status: 'cancelled', progress: file.progress }
          : file,
      ),
    );
    setBusy(false);
    setMessages(['已请求取消转换。']);
  };

  const clearFiles = () => {
    if (busy) return;
    setFiles([]);
    setMessages([]);
  };

  const installImageMagick = async () => {
    if (installingImageMagick || busy) return;
    setInstallingImageMagick(true);
    setMessages(['正在安装 ImageMagick，可能需要几分钟。']);

    try {
      const message = await invoke<string>('install_imagemagick');
      setMessages([message]);
      await refreshToolStatus();
    } catch (error) {
      setMessages([`安装 ImageMagick 失败：${String(error)}`]);
    } finally {
      setInstallingImageMagick(false);
    }
  };

  const openOutputDirectory = async () => {
    if (!settings.outputDirectory) return;
    await invoke('open_output_folder', { path: settings.outputDirectory });
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">开发者：猫汰  版本 v1.0</p>
          <h1 className="app-title">
            <span>小午的图片转换</span>
            <img className="pro-badge" src="/pro-badge.png" alt="Pro" />
          </h1>
        </div>
        <div className="mode-card">
          <strong>当前转换模式</strong>
          <span>{modeLabel(settings.mode)}</span>
        </div>
      </header>

      <section className="workspace">
        <div className="main-panel">
          <section className="cat-banner" aria-label="小午的图片转换 Pro">
            <img src="/cat-banner.png" alt="" />
          </section>
          <DropZone disabled={busy} onPaths={addPaths} />
          {messages.length > 0 && (
            <div className="message-panel">
              {messages.map((message) => <p key={message}>{message}</p>)}
            </div>
          )}
          <FileList files={files} />
        </div>

        <SettingsPanel
          settings={settings}
          status={toolStatus}
          disabled={busy || installingImageMagick}
          installingImageMagick={installingImageMagick}
          onInstallImageMagick={installImageMagick}
          onChange={setSettings}
        />
      </section>

      <Toolbar
        busy={busy}
        canStart={canStart}
        canOpenOutput={Boolean(settings.outputDirectory)}
        onStart={startConvert}
        onCancel={cancelConvert}
        onClear={clearFiles}
        onOpenOutput={openOutputDirectory}
      />
    </main>
  );
}

function modeLabel(mode: ConvertSettings['mode']) {
  if (mode === 'photoshop') return 'Photoshop 高保真';
  if (mode === 'imagemagick') return 'ImageMagick 快速转换';
  return '自动：Photoshop 优先';
}

function compactCompletedFiles(files: AppFile[]) {
  const compacted = files.map((file) =>
    file.status === 'success'
      ? {
          ...file,
          previewPending: false,
          previewError: undefined,
          previewWarning: undefined,
          previewSize: undefined,
          error: undefined,
        }
      : file,
  );

  if (compacted.length <= MAX_VISIBLE_HISTORY) {
    return compacted;
  }

  const keep = compacted.filter((file) => file.status !== 'success');
  const successTail = compacted
    .filter((file) => file.status === 'success')
    .slice(-(MAX_VISIBLE_HISTORY - keep.length));

  return [...keep, ...successTail];
}
