import QualitySlider from './QualitySlider';
import TargetSizeInput from './TargetSizeInput';

interface ToolbarProps {
  quality: number;
  targetSizeMb: number;
  disabled?: boolean;
  canConvert: boolean;
  convertLabel: string;
  onQualityChange: (value: number) => void;
  onTargetSizeChange: (value: number) => void;
  onConvert: () => void;
  onClear: () => void;
}

export default function Toolbar({
  quality,
  targetSizeMb,
  disabled,
  canConvert,
  convertLabel,
  onQualityChange,
  onTargetSizeChange,
  onConvert,
  onClear,
}: ToolbarProps) {
  return (
    <section className="toolbar">
      <QualitySlider value={quality} disabled={disabled} onChange={onQualityChange} />
      <TargetSizeInput value={targetSizeMb} disabled={disabled} onChange={onTargetSizeChange} />
      <div className="toolbar-actions">
        <button type="button" className="primary" disabled={disabled || !canConvert} onClick={onConvert}>
          {convertLabel}
        </button>
        <button type="button" disabled={disabled} onClick={onClear}>
          清空
        </button>
      </div>
    </section>
  );
}
