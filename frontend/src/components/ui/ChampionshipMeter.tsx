import { Meter, type MeterTone } from './Meter';

/**
 * Championship-odds readout. The figure is the real model output; the bar
 * beneath it is a scanning aid, and the "model estimate, not a guarantee"
 * line is load-bearing text rather than fine print.
 */
export function ChampionshipMeter({
  probabilityPct,
  simulations,
  caption = 'Championship Equity',
}: {
  probabilityPct: number;
  simulations?: number;
  caption?: string;
}) {
  const clamped = Math.max(0, Math.min(100, probabilityPct));
  const tone: MeterTone = clamped >= 25 ? 'positive' : clamped >= 10 ? 'warning' : 'neutral';

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className="panel-title">{caption}</h3>
      </div>
      <div className="px-2.5 py-2">
        <div className="num text-3xl leading-none font-semibold text-[color:var(--pats-navy)]">
          {clamped.toFixed(1)}%
        </div>
        <div className="mt-2">
          <Meter value={clamped} tone={tone} />
        </div>
        {simulations !== undefined && (
          <p className="mt-2 text-[10px] text-muted">
            Model estimate from {simulations.toLocaleString()} Monte Carlo simulations — not a guarantee.
          </p>
        )}
      </div>
    </div>
  );
}
