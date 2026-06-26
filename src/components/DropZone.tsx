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
    const files = Array.from(fileList);
    if (files.length === 0) return;

    onFiles(files);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const openFilePicker = () => {
    if (!inputRef.current || disabled) return;
    inputRef.current.value = '';
    inputRef.current.click();
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
        accept=".tif,.tiff,.psd,.jpg,.jpeg"
        multiple
        disabled={disabled}
        onClick={(event) => {
          event.currentTarget.value = '';
        }}
        onChange={(event) => acceptFiles(event.target.files)}
      />
      <div>
        <h2>拖拽 TIFF、PSD 和 JPG 到这里</h2>
        <p>一次至少支持 20 张，默认导出 JPEG</p>
      </div>
      <button type="button" disabled={disabled} onClick={openFilePicker}>
        选择图片
      </button>
    </section>
  );
}
