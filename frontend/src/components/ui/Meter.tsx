import type { ReactNode } from 'react';

export type MeterTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'live';

const TONE_FILL: Record<MeterTone, string> = {
  positive: '#0f5c35',
  warning: '#b07d00',
  negative: '#c60c30',
  neutral: '#002244',
  live: '#1d4f80',
};

const TONE_TEXT: Record<MeterTone, string> = {
  positive: 'text-[#0f5c35]',
  warning: 'text-[#8a5c00]',
  negative: 'text-[#c60c30]',
  neutral: 'text-[color:var(--pats-navy)]',
  live: 'text-[#1d4f80]',
};

/**
 * A thin proportional bar sitting beside the real figure - never in place of
 * it. `value` is always 0-100 (callers normalize whatever raw metric they
 * have); `displayValue` carries the honest number in its own units (a VOR
 * score, a dollar amount, a percentage), so the bar stays a scanning aid and
 * the number stays the source of truth.
 *
 * Deliberately short and square: in a dense table this sits on one row.
 */
export function Meter({
  label,
  value,
  displayValue,
  tone = 'neutral',
  sublabel,
}: {
  label?: string;
  value: number;
  displayValue?: ReactNode;
  tone?: MeterTone;
  sublabel?: string;
  /** Retained for call-site compatibility; the bar is continuous now. */
  segments?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const textClass = TONE_TEXT[tone];

  return (
    <div className="min-w-0">
      {label && <div className="stat-label mb-0.5">{label}</div>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div
          className="h-2 w-24 shrink-0 border border-[color:var(--rule)] bg-[color:var(--pats-gray-100)] sm:w-32"
          role="img"
          aria-label={`${label ?? 'value'}: ${displayValue ?? clamped} out of 100`}
        >
          <div className="h-full" style={{ width: `${clamped}%`, background: TONE_FILL[tone] }} />
        </div>
        {displayValue !== undefined && (
          <span className={`num text-[15px] leading-none font-semibold whitespace-nowrap ${textClass}`}>
            {displayValue}
          </span>
        )}
      </div>
      {sublabel && (
        <div className={`mt-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase ${textClass}`}>
          {sublabel}
        </div>
      )}
    </div>
  );
}
