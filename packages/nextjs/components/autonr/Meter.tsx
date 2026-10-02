type MeterProps = {
  label: string;
  value: number;
  limit: number;
  /** Upper end of the scale. Defaults to `limit`; a larger value draws a marker where the limit sits. */
  scaleMax?: number;
  valueText: string;
  limitText: string;
};

type Severity = "ok" | "near" | "over";

// Fill and track come from the same hue so the bar's state reads across its whole length.
const TONES: Record<Severity, { fill: string; track: string }> = {
  ok: { fill: "fill-primary", track: "fill-primary/15" },
  near: { fill: "fill-warning", track: "fill-warning/25" },
  over: { fill: "fill-error", track: "fill-error/20" },
};

const NEAR_LIMIT = 0.8;

/** A value against a policy limit, e.g. oracle divergence or daily spend. The numbers are always shown as text. */
export const Meter = ({ label, value, limit, scaleMax = limit, valueText, limitText }: MeterProps) => {
  const severity: Severity = value > limit ? "over" : value >= limit * NEAR_LIMIT ? "near" : "ok";
  const scale = Math.max(scaleMax, limit, Number.EPSILON);
  const fill = Math.min(100, (value / scale) * 100);
  const marker = (limit / scale) * 100;
  const tone = TONES[severity];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-base-content/70">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{valueText}</span>
          <span className="text-base-content/60"> / {limitText}</span>
        </span>
      </div>
      <svg
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(scale, value)}
        aria-valuenow={value}
        aria-valuetext={`${valueText} of ${limitText}`}
        width="100%"
        height="8"
        className="block overflow-visible"
      >
        <rect width="100%" height="8" rx="4" className={tone.track} />
        {value > 0 && <rect width={`${Math.max(fill, 1.5)}%`} height="8" rx="4" className={tone.fill} />}
        {marker < 100 && (
          <line x1={`${marker}%`} x2={`${marker}%`} y1="-3" y2="11" strokeWidth="2" className="stroke-base-content" />
        )}
      </svg>
    </div>
  );
};
