interface ToolbarProps {
  busy: boolean;
  canStart: boolean;
  canOpenOutput: boolean;
  onStart: () => void;
  onCancel: () => void;
  onClear: () => void;
  onOpenOutput: () => void;
}

export default function Toolbar({ busy, canStart, canOpenOutput, onStart, onCancel, onClear, onOpenOutput }: ToolbarProps) {
  return (
    <footer className="bottom-toolbar">
      <button className="primary" type="button" disabled={!canStart || busy} onClick={onStart}>
        <span className="button-icon play-icon" aria-hidden="true" />
        开始转换
      </button>
      <button type="button" disabled={!busy} onClick={onCancel}>
        <span className="button-icon cancel-icon" aria-hidden="true" />
        取消
      </button>
      <button type="button" disabled={busy} onClick={onClear}>
        <span className="button-icon trash-icon" aria-hidden="true" />
        清空列表
      </button>
      <button type="button" disabled={!canOpenOutput} onClick={onOpenOutput}>
        <span className="button-icon folder-icon" aria-hidden="true" />
        打开输出文件夹
      </button>
    </footer>
  );
}
