import type { AppFile } from '../types/file';
import { formatBytes } from '../utils/formatBytes';
import ProgressBar from './ProgressBar';
import StatusBadge from './StatusBadge';

interface FileListProps {
  files: AppFile[];
}

const MAX_RENDERED_ROWS = 600;

export default function FileList({ files }: FileListProps) {
  if (files.length === 0) {
    return <div className="empty-list">拖入图片或文件夹后，文件会显示在这里。</div>;
  }

  const visibleFiles = files.length > MAX_RENDERED_ROWS ? files.slice(-MAX_RENDERED_ROWS) : files;

  return (
    <section className="file-panel">
      <div className="file-summary">
        共 {files.length} 个文件
        {files.length > visibleFiles.length && `，当前显示最近 ${visibleFiles.length} 个`}
      </div>
      <div className="file-table">
        <div className="file-row file-head">
          <span>文件名</span>
          <span>格式</span>
          <span>原始大小</span>
          <span>预览大小</span>
          <span>状态</span>
          <span>进度</span>
          <span>提示 / 错误</span>
        </div>
        {visibleFiles.map((file) => (
          <div className="file-row" key={file.id}>
            <span className="file-name" title={file.path}>{file.name}</span>
            <span>{file.format}</span>
            <span>{formatBytes(file.originalSize)}</span>
            <span>
              {file.outputSize ? (
                formatBytes(file.outputSize)
              ) : file.previewPending ? (
                '计算中'
              ) : file.previewSize ? (
                <span className="preview-value">
                  {formatBytes(file.previewSize)}
                  {file.previewWarning && <small title={file.previewWarning}>{file.previewWarning}</small>}
                </span>
              ) : file.previewError ? (
                <span className="preview-error" title={file.previewError}>预览失败</span>
              ) : (
                '-'
              )}
            </span>
            <span><StatusBadge status={file.status} /></span>
            <span><ProgressBar value={file.progress} /></span>
            <span className="error-cell" title={file.error || file.previewWarning}>{file.error || file.previewWarning || '-'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
