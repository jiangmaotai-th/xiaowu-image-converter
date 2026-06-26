interface QualitySliderProps {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export default function QualitySlider({ value, disabled, onChange }: QualitySliderProps) {
  return (
    <label className="field slider-field">
      <span>JPEG 质量</span>
      <div className="slider-row">
        <input
          type="range"
          min="0.4"
          max="1"
          step="0.01"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <strong>{value.toFixed(2)}</strong>
      </div>
    </label>
  );
}
