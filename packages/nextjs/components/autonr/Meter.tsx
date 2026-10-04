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

// Within the limit reads as enforced (the accent), near it neutral, over it rose; the track stays quiet.
const TONES: Record<Severity, { fill: string; track: string }> = {
  ok: { fill: "fill-success", track: "fill-white/[0.06]" },
  near: { fill: "fill-warning", track: "fill-white/[0.06]" },
  over: { fill: "fill-error", track: "fill-error/15" },
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
        <span className="text-[#a6a6a6]">{label}</span>
        <span className="font-mono tabular-nums">
          <span className="font-medium text-white">{valueText}</span>
          <span className="text-[#7a7a7a]"> / {limitText}</span>
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
        height="6"
        className="block overflow-visible"
      >
        <rect width="100%" height="6" rx="3" className={tone.track} />
        {value > 0 && <rect width={`${Math.max(fill, 1.5)}%`} height="6" rx="3" className={tone.fill} />}
        {marker < 100 && (
          <line x1={`${marker}%`} x2={`${marker}%`} y1="-3" y2="9" strokeWidth="1.5" className="stroke-white/70" />
        )}
      </svg>
    </div>
  );
};
