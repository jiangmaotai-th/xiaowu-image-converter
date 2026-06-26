import { useRef, useState } from 'react';

interface DropZoneProps {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

export default function DropZone({ disabled, onFiles }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const acceptFiles = (fileList: FileList | null) => {
    if (!fileList || disabled) return;
    onFiles(Array.from(fileList));
  };

  return (
    <section
      className={`drop-zone ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        acceptFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".tif,.tiff,.psd"
        multiple
        disabled={disabled}
        onChange={(event) => acceptFiles(event.target.files)}
      />
      <div>
        <h2>拖拽 TIFF 和 PSD 到这里</h2>
        <p>一次至少支持 20 张，默认导出 JPEG</p>
      </div>
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
        选择图片
      </button>
    </section>
  );
}
