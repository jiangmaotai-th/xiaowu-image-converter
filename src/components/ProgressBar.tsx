export default function ProgressBar({ value }: { value: number }) {
  const normalized = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-wrap">
      <div className="progress-track" aria-label={`进度 ${Math.round(normalized)}%`}>
        <span style={{ width: `${normalized}%` }} />
      </div>
      <strong>{Math.round(normalized)}%</strong>
    </div>
  );
}
