interface TargetSizeInputProps {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export default function TargetSizeInput({ value, disabled, onChange }: TargetSizeInputProps) {
  return (
    <label className="field target-field">
      <span>目标大小</span>
      <div className="input-with-unit">
        <input
          type="number"
          min="1"
          step="1"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))}
        />
        <span>MB</span>
      </div>
    </label>
  );
}
