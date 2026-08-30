import { Mascot } from './Mascot';
import { Meter, type MeterTone } from './Meter';

/**
 * The app's signature visual element (per design brief): a championship-odds
 * readout with a pixel trophy that grows more prominent as probability rises.
 * The number is always the real model output - the trophy's glow is cosmetic
 * emphasis on top of it, never a substitute for it, and the "model estimate,
 * not a guarantee" caveat is load-bearing text, not fine print.
 */
export function ChampionshipMeter({
  probabilityPct,
  simulations,
  caption = 'CHAMPIONSHIP EQUITY',
}: {
  probabilityPct: number;
  simulations?: number;
  caption?: string;
}) {
  const clamped = Math.max(0, Math.min(100, probabilityPct));
  const tone: MeterTone = clamped >= 25 ? 'positive' : clamped >= 10 ? 'warning' : 'neutral';
  const trophyOpacity = Math.max(0.3, Math.min(1, clamped / 35));
  const trophyScale = 0.85 + Math.min(1, clamped / 40) * 0.3;

  return (
    <div className="arcade-panel arcade-panel-accent pixel-bolts rounded-md bg-slate-950/60 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-[9px] tracking-wide text-violet-400">{caption}</div>
          <div className="mt-1.5 font-scoreboard text-4xl leading-none text-slate-100 sm:text-5xl">{clamped.toFixed(1)}%</div>
        </div>
        <div style={{ opacity: trophyOpacity, transform: `scale(${trophyScale})` }} className="shrink-0 transition-[opacity,transform] duration-500">
          <Mascot state="championship" size={56} />
        </div>
      </div>
      <div className="mt-4">
        <Meter value={clamped} tone={tone} segments={28} />
      </div>
      {simulations !== undefined && (
        <p className="mt-3 text-[11px] text-slate-500">
          Model estimate from {simulations.toLocaleString()} Monte Carlo simulations — not a guarantee.
        </p>
      )}
    </div>
  );
}
