import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`arcade-panel arcade-panel-accent pixel-bolts rounded-md bg-slate-900/70 p-4 sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="flex items-center gap-2 font-display text-[11px] leading-relaxed tracking-wide text-violet-400 sm:text-xs">
        <span className="inline-block h-2.5 w-2.5 shrink-0 bg-violet-500" aria-hidden="true" />
        {children}
      </h3>
      {subtitle && <p className="mt-1.5 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/60 px-3 py-2.5">
      <div className="font-display text-[9px] leading-relaxed tracking-wide text-slate-500">{label}</div>
      <div className="mt-1.5 truncate font-scoreboard text-2xl leading-none text-slate-100">{value}</div>
      {hint && <div className="mt-1.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}
