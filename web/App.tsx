import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Download, FileImage, FolderOpen, RotateCcw, Trash2, UploadCloud, X } from 'lucide-react';
import { clearCache, deleteCached, getCached, putCached } from './cache';
import type { Format, ImageRow, Settings, WorkerResult } from './types';

const DEFAULT_SETTINGS: Settings = { quality: 92, targetMb: 10 };
const ROW_HEIGHT = 54;
const TABLE_HEIGHT = 580;
const OVERSCAN = 6;
const PREVIEW_CACHE_LIMIT = 512_000_000;
let pendingCacheReset: Promise<void> = Promise.resolve();

function resetCache(): Promise<void> {
  pendingCacheReset = pendingCacheReset.catch(() => undefined).then(clearCache);
  return pendingCacheReset;
}

type SaveDirectory = FileSystemDirectoryHandle;

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function outputName(name: string, used: Set<string>): string {
  const base = name.replace(/\.(tif|tiff|heic|heif)$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  let candidate = `${base}.jpg`;
  let number = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base}_${number++}.jpg`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function detectFormat(name: string): Format | null {
  if (/\.tiff?$/i.test(name)) return 'TIFF';
  if (/\.hei[cf]$/i.test(name)) return 'HEIC';
  return null;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cacheKey(id: string, settings: Settings): string {
  return `${settings.quality}:${settings.targetMb}:${id}`;
}

async function triggerDownload(name: string, blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  await new Promise((resolve) => window.setTimeout(resolve, 180));
}

function runWorker(id: string, file: File, format: Format, settings: Settings, active: MutableRefObject<{ worker: Worker; reject: (reason: Error) => void } | null>, maxBytes?: number): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./convertWorker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
      if (active.current?.worker === worker) active.current = null;
    };
    active.current = { worker, reject: (reason) => { finish(); reject(reason); } };
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: WorkerResult; error?: string }>) => {
      finish();
      if (event.data.ok && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error || '转换失败。'));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('解码进程异常结束；请检查文件是否损坏或尺寸过大。'));
    };
    try { worker.postMessage({ id, file, format, settings, maxBytes }); }
    catch (error) { finish(); reject(error instanceof Error ? error : new Error(String(error))); }
  });
}

export default function App() {
  const rows = useRef(new Map<string, ImageRow>());
  const names = useRef(new Set<string>());
  const active = useRef<{ worker: Worker; reject: (reason: Error) => void } | null>(null);
  const epoch = useRef(0);
  const previousSettings = useRef<string | null>(null);
  const canceled = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const scrollBox = useRef<HTMLDivElement>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [version, setVersion] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [directory, setDirectory] = useState<SaveDirectory | null>(null);

  const updateRow = (id: string, patch: Partial<ImageRow>) => {
    const current = rows.current.get(id);
    if (!current) return;
    rows.current.set(id, { ...current, ...patch });
    setVersion((value) => value + 1);
  };

  const stopWorker = () => {
    active.current?.reject(new Error('已取消'));
    active.current = null;
  };

  useEffect(() => {
    if (ids.length === 0 || busy) return;
    const run = ++epoch.current;
    stopWorker();
    const settingsKey = `${settings.quality}:${settings.targetMb}`;
    const [oldQuality, oldTarget] = previousSettings.current?.split(':').map(Number) ?? [];
    const settingsChanged = previousSettings.current !== settingsKey;
    previousSettings.current = settingsKey;
    if (settingsChanged) {
      for (const row of rows.current.values()) {
        if (row.file) rows.current.set(row.id, {
          ...row, status: 'waiting', outputSize: undefined, error: undefined,
          previewCap: settings.quality < oldQuality && settings.targetMb === oldTarget ? row.outputSize : undefined,
        });
      }
      setVersion((value) => value + 1);
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (settingsChanged) await resetCache();
          else await pendingCacheReset;
        } catch {
          setNotice('浏览器临时存储不可用，预览将于转换时生成。');
          return;
        }
        let cachedBytes = 0;
        for (const row of rows.current.values()) {
          if (row.status === 'ready') cachedBytes += row.outputSize ?? 0;
        }
        for (const id of ids) {
          if (run !== epoch.current) return;
          if (cachedBytes >= PREVIEW_CACHE_LIMIT) {
            setNotice('本批预览缓存已达到 512 MB，剩余文件会在转换时逐张精确计算。');
            return;
          }
          const row = rows.current.get(id);
          if (!row?.file || row.status === 'done' || row.status === 'ready') continue;
          updateRow(id, { status: 'previewing', outputSize: undefined, error: undefined });
          try {
            const result = await runWorker(id, row.file, row.format, settings, active, row.previewCap);
            if (run !== epoch.current) return;
            const key = cacheKey(id, settings);
            await putCached(key, result.blob);
            if (run !== epoch.current) { await deleteCached(key); return; }
            cachedBytes += result.blob.size;
            updateRow(id, { status: 'ready', outputSize: result.blob.size, width: result.width, height: result.height, warning: result.warning });
          } catch (error) {
            if (run !== epoch.current) return;
            const text = messageFrom(error);
            if (/quota|storage|database|transaction/i.test(text)) {
              updateRow(id, { status: 'waiting', error: '缓存空间不足，将在转换时计算。' });
              setNotice('浏览器缓存空间不足，剩余文件将在点击转换后逐张处理。');
              return;
            }
            updateRow(id, { status: 'failed', error: text });
          }
        }
      })();
    }, 350);
    return () => { window.clearTimeout(timer); if (run === epoch.current) { epoch.current += 1; stopWorker(); } };
  }, [revision, settings.quality, settings.targetMb]);

  useEffect(() => () => { epoch.current += 1; stopWorker(); }, []);

  const addFiles = (files: File[]) => {
    if (busy) return;
    const accepted = files.filter((file) => detectFormat(file.name));
    if (accepted.length !== files.length) setNotice(`已跳过 ${files.length - accepted.length} 个非 TIFF / HEIC 文件。`);
    if (accepted.length === 0) return;
    const next: string[] = [];
    for (const file of accepted) {
      const id = crypto.randomUUID();
      rows.current.set(id, {
        id, file, name: file.name, outputName: outputName(file.name, names.current),
        format: detectFormat(file.name)!, inputSize: file.size, status: 'waiting',
      });
      next.push(id);
    }
    setIds((current) => [...current, ...next]);
    setRevision((value) => value + 1);
  };

  const chooseDirectory = async () => {
    if (!('showDirectoryPicker' in window)) return;
    try {
      const picker = window as Window & { showDirectoryPicker: () => Promise<SaveDirectory> };
      setDirectory(await picker.showDirectoryPicker());
      setNotice('输出目录已选择，转换后会直接写入该文件夹。');
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setNotice(`选择目录失败：${messageFrom(error)}`);
    }
  };

  const saveBlob = async (row: ImageRow, blob: Blob) => {
    if (directory) {
      const base = row.outputName.replace(/\.jpg$/i, '');
      let name = row.outputName;
      let number = 2;
      for (;;) {
        try {
          await directory.getFileHandle(name);
          name = `${base}_${number++}.jpg`;
        } catch (error) {
          if ((error as DOMException).name === 'NotFoundError') break;
          throw error;
        }
      }
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try { await writable.write(blob); await writable.close(); }
      catch (error) { await writable.abort().catch(() => undefined); throw error; }
      updateRow(row.id, { outputName: name });
    } else {
      await triggerDownload(row.outputName, blob);
    }
  };

  const start = async () => {
    if (busy || ids.length === 0) return;
    epoch.current += 1;
    stopWorker();
    canceled.current = false;
    setBusy(true);
    let success = 0;
    let failed = 0;
    for (const id of ids) {
      if (canceled.current) break;
      const row = rows.current.get(id);
      if (!row?.file || row.status === 'done') continue;
      updateRow(id, { status: 'converting', error: undefined });
      try {
        const key = cacheKey(id, settings);
        let blob = await getCached(key).catch(() => undefined);
        let width = row.width;
        let height = row.height;
        if (!blob) {
          const result = await runWorker(id, row.file, row.format, settings, active, row.previewCap);
          blob = result.blob;
          width = result.width;
          height = result.height;
        }
        if (canceled.current) break;
        const limit = Math.floor(settings.targetMb * 1_000_000);
        if (blob.type !== 'image/jpeg' || blob.size < 4 || blob.size >= limit) throw new Error('输出文件未通过大小校验。');
        updateRow(id, { outputSize: blob.size, width, height });
        await saveBlob(row, blob);
        await deleteCached(key).catch(() => undefined);
        updateRow(id, { status: 'done', file: null, outputSize: blob.size });
        success += 1;
      } catch (error) {
        if (canceled.current) break;
        updateRow(id, { status: 'failed', error: messageFrom(error) });
        failed += 1;
      }
    }
    setBusy(false);
    if (canceled.current) setNotice(`已取消。成功 ${success} 个，失败 ${failed} 个。`);
    else setNotice(`处理完成：${success} 个已${directory ? '保存' : '发起下载'}，${failed} 个失败。`);
  };

  const cancel = () => {
    canceled.current = true;
    epoch.current += 1;
    stopWorker();
  };

  const clear = () => {
    cancel();
    previousSettings.current = null;
    rows.current.clear();
    names.current.clear();
    setIds([]);
    setRevision((value) => value + 1);
    setNotice('列表已清空。');
    void resetCache().catch(() => undefined);
  };

  const remove = (id: string) => {
    if (busy) return;
    const row = rows.current.get(id);
    if (row) names.current.delete(row.outputName.toLowerCase());
    rows.current.delete(id);
    setIds((current) => current.filter((item) => item !== id));
    setRevision((value) => value + 1);
    void deleteCached(cacheKey(id, settings)).catch(() => undefined);
  };

  const retry = (id: string) => {
    const row = rows.current.get(id);
    if (!row?.file || busy) return;
    updateRow(id, { status: 'waiting', error: undefined });
    setRevision((value) => value + 1);
  };

  const summary = useMemo(() => {
    let done = 0;
    let failed = 0;
    let ready = 0;
    for (const id of ids) {
      const status = rows.current.get(id)?.status;
      if (status === 'done') done += 1;
      if (status === 'failed') failed += 1;
      if (status === 'ready') ready += 1;
    }
    return { done, failed, ready };
  }, [ids, version]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(ids.length, startIndex + Math.ceil(TABLE_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2);
  const visibleIds = ids.slice(startIndex, endIndex);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand-mark"><FileImage size={22} strokeWidth={1.9} /></div>
        <div className="brand-copy"><h1>小午的图片转换</h1><p>TIFF / HEIC 转 JPG</p></div>
        <span className="local-badge">本地处理 · 无需上传</span>
      </header>

      <main className="content">
        <section className="intro"><div><p className="eyebrow">BATCH IMAGE CONVERTER</p><h2>批量转换，大小看得准。</h2><p>预览的是实际生成的 JPEG 文件，下载使用同一份数据。</p></div><div className="limit-pill">默认小于 <strong>10 MB</strong></div></section>

        <div className="cat-strip"><img src="./cat-banner.png" alt="五只猫咪" /></div>
        <section className="workspace">
          <div className="left-column">
            <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}>
              <div className="upload-icon"><UploadCloud size={30} strokeWidth={1.7} /></div>
              <div><h3>拖拽 TIFF、HEIC 图片到这里</h3><p>支持一次选择多张，文件只在当前浏览器中处理</p></div>
              <div className="drop-actions"><button type="button" onClick={() => fileInput.current?.click()} disabled={busy}><FileImage size={17} />选择文件</button><button type="button" onClick={() => folderInput.current?.click()} disabled={busy}><FolderOpen size={17} />选择文件夹</button></div>
              <input ref={fileInput} type="file" accept=".tif,.tiff,.heic,.heif,image/tiff,image/heic,image/heif" multiple hidden onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
              <input ref={(node) => { folderInput.current = node; node?.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
            </div>

            {notice && <div className="notice" role="status">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={16} /></button></div>}

            <div className="file-panel">
              <div className="file-heading"><div><strong>文件列表</strong><span>共 {ids.length} 张 · 预览完成 {summary.ready} · 已处理 {summary.done} · 失败 {summary.failed}</span></div><span className="exact-note">预览大小 = 下载文件的实际大小</span></div>
              <div className="table-header"><span>文件名</span><span>格式 / 原始大小</span><span>转换后预览</span><span>状态</span><span>操作</span></div>
              {ids.length === 0 ? <div className="empty-state"><FileImage size={32} strokeWidth={1.4} /><span>加入图片后，这里会显示尺寸与转换后大小</span></div> :
                <div className="table-scroll" ref={scrollBox} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
                  <div className="table-spacer" style={{ height: ids.length * ROW_HEIGHT }}>
                    {visibleIds.map((id, offset) => {
                      const row = rows.current.get(id);
                      if (!row) return null;
                      return <div className="file-row" key={id} style={{ top: (startIndex + offset) * ROW_HEIGHT }}>
                        <div className="filename" title={row.name}><FileImage size={16} /><span>{row.name}</span></div>
                        <div className="meta"><strong>{row.format}</strong><span>{formatBytes(row.inputSize)}{row.width ? ` · ${row.width} × ${row.height}` : ''}</span></div>
                        <div className="preview-size">{row.outputSize !== undefined ? <><strong>{formatBytes(row.outputSize)}</strong><small>{row.outputSize.toLocaleString('zh-CN')} 字节</small></> : <span className="muted">{row.status === 'previewing' ? '正在精确预览…' : '等待预览'}</span>}</div>
                        <div className="state"><span className={`state-badge state-${row.status}`}>{({ waiting: '等待中', previewing: '预览中', ready: '可下载', converting: '转换中', done: directory ? '已保存' : '已发起下载', failed: '失败', canceled: '已取消' })[row.status]}</span>{row.error && <small title={row.error}>{row.error}</small>}{!row.error && row.warning && <small title={row.warning}>{row.warning}</small>}</div>
                        <div className="row-actions">{row.status === 'failed' && <button type="button" title="重试" aria-label={`重试 ${row.name}`} onClick={() => retry(id)}><RotateCcw size={16} /></button>}<button type="button" title="移除" aria-label={`移除 ${row.name}`} disabled={busy} onClick={() => remove(id)}><X size={16} /></button></div>
                      </div>;
                    })}
                  </div>
                </div>}
            </div>
          </div>

          <aside className="settings-panel"><div className="panel-title"><h3>转换设置</h3><span>JPG</span></div>
            <label className="control"><span>目标大小</span><div className="size-controls"><select value={settings.targetMb === 5 || settings.targetMb === 10 || settings.targetMb === 20 ? settings.targetMb : 'custom'} disabled={busy} onChange={(event) => setSettings((current) => ({ ...current, targetMb: Number(event.target.value) || current.targetMb }))}><option value={5}>小于 5 MB</option><option value={10}>小于 10 MB</option><option value={20}>小于 20 MB</option><option value="custom">自定义</option></select><input type="number" min="0.1" max="200" step="0.1" value={settings.targetMb} disabled={busy} onChange={(event) => { const size = Number(event.target.value); if (size > 0 && size <= 200) setSettings((current) => ({ ...current, targetMb: size })); }} aria-label="目标大小，MB" /></div><small>严格小于目标值，按 1 MB = 1,000,000 字节计算</small></label>
            <label className="control"><span>JPEG 初始质量 <strong>{settings.quality}</strong></span><input className="quality-slider" type="range" min="40" max="100" step="1" value={settings.quality} disabled={busy} onChange={(event) => setSettings((current) => ({ ...current, quality: Number(event.target.value) }))} /><small>超过目标时会继续降质，必要时缩小尺寸</small></label>
            <div className="control"><span>保存位置</span><div className="save-box"><FolderOpen size={18} /><span title={directory?.name}>{directory?.name ?? '浏览器下载目录'}</span>{'showDirectoryPicker' in window && <button type="button" disabled={busy} onClick={() => void chooseDirectory()}>选择</button>}</div><small>{directory ? '转换后直接保存到所选文件夹' : '文件将分别下载为 JPG；浏览器可能询问是否允许多文件下载'}</small></div>
            <div className="settings-note"><strong>关于预览</strong><p>添加图片或调整设置后逐张编码，列表显示实际 JPEG 字节数。开始转换时直接使用已预览的文件。</p></div>
            <div className="privacy-note">所有转换在本机浏览器完成，不上传服务器。TIFF 默认取第一页，透明区域填充白色。</div>
          </aside>
        </section>
      </main>

      <footer className="bottom-bar"><div className="footer-meta">{ids.length > 0 ? `共 ${ids.length} 张，已完成 ${summary.done} 张` : '准备就绪'}</div><div className="footer-actions"><button type="button" className="ghost" disabled={ids.length === 0 || busy} onClick={clear}><Trash2 size={17} />清空列表</button><button type="button" className="ghost" disabled={!busy} onClick={cancel}><X size={17} />取消</button><button type="button" className="primary" disabled={busy || ids.length === 0 || summary.done === ids.length} onClick={() => void start()}><Download size={18} />{busy ? '正在逐张处理…' : '转换并下载 JPG'}</button></div></footer>
    </div>
  );
}
