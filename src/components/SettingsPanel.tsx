import { open } from '@tauri-apps/plugin-dialog';

import type { ConvertSettings, ToolStatus } from '../types/settings';

interface SettingsPanelProps {
  settings: ConvertSettings;
  status: ToolStatus | null;
  disabled?: boolean;
  installingImageMagick?: boolean;
  onInstallImageMagick: () => void;
  onChange: (settings: ConvertSettings) => void;
}

export default function SettingsPanel({
  settings,
  status,
  disabled,
  installingImageMagick,
  onInstallImageMagick,
  onChange,
}: SettingsPanelProps) {
  const patch = (partial: Partial<ConvertSettings>) => onChange({ ...settings, ...partial });

  const chooseOutputDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') {
      patch({ outputDirectory: selected });
    }
  };

  return (
    <aside className="settings-panel">
      <h2>转换设置</h2>

      <label className="field">
        输出格式
        <select value={settings.outputFormat} disabled>
          <option value="JPEG">JPEG</option>
        </select>
      </label>

      <label className="field">
        目标大小
        <select
          value={[5, 10, 20].includes(settings.targetSizeMb) ? settings.targetSizeMb : 'custom'}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === 'custom') return;
            patch({ targetSizeMb: Number(event.target.value) });
          }}
        >
          <option value={5}>5MB</option>
          <option value={10}>10MB</option>
          <option value={20}>20MB</option>
          <option value="custom">自定义</option>
        </select>
        <input
          type="number"
          min={1}
          max={500}
          value={settings.targetSizeMb}
          disabled={disabled}
          onChange={(event) => patch({ targetSizeMb: Math.max(1, Number(event.target.value)) })}
        />
      </label>

      <label className="field">
        JPEG 质量
        <div className="slider-row">
          <input
            type="range"
            min={65}
            max={100}
            value={settings.jpegQuality}
            disabled={disabled}
            onChange={(event) => patch({ jpegQuality: Number(event.target.value) })}
          />
          <strong>{settings.jpegQuality}</strong>
        </div>
      </label>

      <label className="field">
        转换模式
        <select value={settings.mode} disabled={disabled} onChange={(event) => patch({ mode: event.target.value as ConvertSettings['mode'] })}>
          <option value="auto">自动：优先 Photoshop</option>
          <option value="photoshop">Photoshop 高保真</option>
          <option value="imagemagick">ImageMagick 快速转换</option>
        </select>
      </label>

      <label className="field">
        输出目录
        <div className="path-picker">
          <input value={settings.outputDirectory || '未选择'} readOnly />
          <button type="button" disabled={disabled} onClick={chooseOutputDirectory}>选择</button>
        </div>
      </label>

      <label className="field">
        文件名后缀
        <input
          value={settings.filenameSuffix}
          disabled={disabled}
          onChange={(event) => patch({ filenameSuffix: event.target.value })}
          placeholder="_converted"
        />
      </label>

      <label className="field">
        并发数量
        <select
          value={settings.concurrency}
          disabled={disabled}
          onChange={(event) => patch({ concurrency: Number(event.target.value) as ConvertSettings['concurrency'] })}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>

      <label className="check-field">
        <input
          type="checkbox"
          checked={settings.allowResize}
          disabled={disabled}
          onChange={(event) => patch({ allowResize: event.target.checked })}
        />
        允许缩小尺寸以压到目标大小
      </label>

      <div className="tool-status">
        <div className="tool-status-item">
          <div>
            <span className={status?.photoshopAvailable ? 'dot ok' : 'dot'} />
            Photoshop {status?.photoshopAvailable ? '已检测到' : '未检测到'}
          </div>
          {status?.photoshopAvailable && (
            <dl>
              <dt>应用名</dt>
              <dd>{status.photoshopAppName}</dd>
              <dt>版本号</dt>
              <dd>{status.photoshopVersion}</dd>
              <dt>路径</dt>
              <dd title={status.photoshopPath}>{status.photoshopPath}</dd>
            </dl>
          )}
        </div>
        <div className="tool-status-item">
          <div>
            <span className={status?.imagemagickAvailable ? 'dot ok' : 'dot'} />
            ImageMagick {status?.imagemagickAvailable ? '已检测到' : '未检测到'}
          </div>
          {status?.imagemagickAvailable && (
            <dl>
              <dt>版本</dt>
              <dd>{status.imagemagickVersion}</dd>
            </dl>
          )}
          {status && !status.imagemagickAvailable && (
            <button
              className="install-button"
              type="button"
              disabled={disabled || installingImageMagick}
              onClick={onInstallImageMagick}
            >
              {installingImageMagick ? '正在安装...' : '一键安装 ImageMagick'}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
