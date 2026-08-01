import type { FileStatus } from '../types/file';

const labels: Record<FileStatus, string> = {
  queued: '等待中',
  converting: '转换中',
  compressing: '压缩中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

export default function StatusBadge({ status }: { status: FileStatus }) {
  return <span className={`status-badge status-${status}`}>{labels[status]}</span>;
}
