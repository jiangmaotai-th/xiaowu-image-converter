import type { ImageJob } from '../types';
import { formatBytes } from '../utils/formatBytes';
import ProgressBar from './ProgressBar';

interface FileListProps {
  jobs: ImageJob[];
  totalCount: number;
}

const statusText: Record<ImageJob['status'], string> = {
  queued: '等待',
  processing: '转换中',
  done: '完成',
  error: '失败',
};

export default function FileList({ jobs, totalCount }: FileListProps) {
  if (totalCount === 0) {
    return <div className="empty-list">还没有文件。把 TIFF 或 PSD 拖进来，就可以开始转换。</div>;
  }

  const hiddenCount = Math.max(0, totalCount - jobs.length);

  return (
    <section className="file-panel">
      <div className="file-summary">
        共 {totalCount} 个文件
        {hiddenCount > 0 ? `，为保持流畅仅显示最近 ${jobs.length} 个` : ''}
      </div>
      <div className="file-table">
        <div className="file-row file-head">
          <span>文件名</span>
          <span>原始大小</span>
          <span>格式</span>
          <span>尺寸</span>
          <span>状态</span>
          <span>转换后</span>
          <span>保存</span>
        </div>
        {jobs.map((job) => (
          <div className="file-row" key={job.id}>
            <span className="file-name" title={job.name}>{job.name}</span>
            <span>{formatBytes(job.originalSize)}</span>
            <span>{job.format}</span>
            <span>{job.width && job.height ? `${job.width} x ${job.height}` : '-'}</span>
            <span>
              <span className={`status status-${job.status}`}>{statusText[job.status]}</span>
              {job.status === 'processing' && <ProgressBar value={job.progress} />}
              {job.warning && <small className="warning">{job.warning}</small>}
              {job.error && <small className="error">{job.error}</small>}
            </span>
            <span>
              {formatBytes(job.outputSize)}
              {job.qualityUsed && <small>质量 {job.qualityUsed.toFixed(2)}</small>}
            </span>
            <span>{job.downloaded ? '已下载' : '-'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
