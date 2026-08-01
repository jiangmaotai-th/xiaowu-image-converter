import { open } from '@tauri-apps/plugin-dialog';

interface DropZoneProps {
  disabled?: boolean;
  onPaths: (paths: string[]) => void;
}

export default function DropZone({ disabled, onPaths }: DropZoneProps) {
  const chooseFiles = async () => {
    if (disabled) return;
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: 'Images',
          extensions: ['psd', 'psb', 'tif', 'tiff', 'png', 'jpg', 'jpeg', 'heic', 'webp', 'bmp'],
        },
      ],
    });
    if (!selected) return;
    onPaths(Array.isArray(selected) ? selected : [selected]);
  };

  const chooseFolder = async () => {
    if (disabled) return;
    const selected = await open({
      multiple: true,
      directory: true,
    });
    if (!selected) return;
    onPaths(Array.isArray(selected) ? selected : [selected]);
  };

  return (
    <section className="drop-zone">
      <div>
        <h2>拖拽 PSD、TIFF、PNG、JPG、HEIC、WebP 到这里</h2>
        <p>也可以拖入文件夹，所有转换都在本机完成</p>
      </div>
      <div className="drop-actions">
        <button className="icon-button file-button" type="button" disabled={disabled} onClick={chooseFiles}>
          <span className="button-icon file-icon" aria-hidden="true" />
          选择文件
        </button>
        <button className="icon-button folder-button" type="button" disabled={disabled} onClick={chooseFolder}>
          <span className="button-icon folder-icon" aria-hidden="true" />
          选择文件夹
        </button>
      </div>
    </section>
  );
}
