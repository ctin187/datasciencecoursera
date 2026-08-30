import type { ReactNode } from 'react';

export type MeterTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'live';

const TONE_FILL: Record<MeterTone, string> = {
  positive: 'bg-emerald-500',
  warning: 'bg-amber-500',
  negative: 'bg-red-500',
  neutral: 'bg-violet-500',
  live: 'bg-sky-500',
};

const TONE_TEXT: Record<MeterTone, string> = {
  positive: 'text-emerald-400',
  warning: 'text-amber-400',
  negative: 'text-red-400',
  neutral: 'text-violet-400',
  live: 'text-sky-400',
};

/**
 * Arcade power-meter: a segmented block bar communicating strength/urgency at
 * a glance, alongside the real number - never color/fill alone. `value` is
 * always 0-100 (callers normalize whatever raw metric they have); the
 * `displayValue` shown next to it can be the raw metric in its own units
 * (a VOR score, a dollar amount, a percentage) so the meter's visual language
 * is consistent everywhere while the number stays honest.
 */
export function Meter({
  label,
  value,
  displayValue,
  tone = 'neutral',
  sublabel,
  segments = 16,
}: {
  label?: string;
  value: number;
  displayValue?: ReactNode;
  tone?: MeterTone;
  sublabel?: string;
  segments?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const filledCount = Math.round((clamped / 100) * segments);
  const fillClass = TONE_FILL[tone];
  const textClass = TONE_TEXT[tone];

  return (
    <div className="min-w-0">
      {label && <div className="mb-1 font-display text-[8px] leading-relaxed tracking-wide text-slate-500 uppercase">{label}</div>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex gap-[2px]" role="img" aria-label={`${label ?? 'value'}: ${displayValue ?? clamped} out of 100`}>
          {Array.from({ length: segments }).map((_, i) => (
            <span
              key={i}
              className={`h-3 w-1.5 sm:h-3.5 sm:w-2 ${i < filledCount ? `${fillClass} ${i === filledCount - 1 ? 'meter-fill-live' : ''}` : 'bg-slate-800'}`}
            />
          ))}
        </div>
        {displayValue !== undefined && <span className={`font-scoreboard text-xl leading-none whitespace-nowrap ${textClass}`}>{displayValue}</span>}
      </div>
      {sublabel && <div className={`mt-1 font-mono text-[11px] font-semibold tracking-wide uppercase ${textClass}`}>{sublabel}</div>}
    </div>
  );
}
