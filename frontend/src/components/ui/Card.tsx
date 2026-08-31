import type { ReactNode } from 'react';

/**
 * A flat, bordered section panel. Square corners, hairline border, no shadow
 * and no gradient - the FanGraphs-style container, where the chrome gets out
 * of the way of the numbers.
 */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

/**
 * Section header. Renders as a navy bar across the top of the panel, which is
 * what gives the app its scannable "table of contents" rhythm at a glance.
 */
export function CardTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <>
      <div className="panel-head">
        <h3 className="panel-title">{children}</h3>
      </div>
      {subtitle && <p className="panel-subtitle">{subtitle}</p>}
    </>
  );
}

/**
 * Compact metric readout. Label above, monospaced figure below, so columns of
 * these line up on the decimal.
 */
export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="border border-[color:var(--rule)] bg-white px-2 py-1.5">
      <div className="stat-label">{label}</div>
      <div className="stat-value mt-0.5 truncate">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted">{hint}</div>}
    </div>
  );
}
