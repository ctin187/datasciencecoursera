import type { ReactNode } from 'react';

const COLORS: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  greenDark: 'bg-emerald-600/25 text-emerald-300 border-emerald-500/60',
  red: 'bg-red-500/15 text-red-400 border-red-500/40',
  yellow: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  orange: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
  blue: 'bg-sky-500/15 text-sky-400 border-sky-500/40',
  purple: 'bg-violet-500/15 text-violet-400 border-violet-500/40',
  gray: 'bg-slate-500/15 text-slate-400 border-slate-500/40',
};

const DOT_COLORS: Record<string, string> = {
  green: 'bg-emerald-400',
  greenDark: 'bg-emerald-300',
  red: 'bg-red-400',
  yellow: 'bg-amber-400',
  orange: 'bg-orange-400',
  blue: 'bg-sky-400',
  purple: 'bg-violet-400',
  gray: 'bg-slate-400',
};

/** Small "indicator light" pill - the arcade-panel equivalent of a status LED. Color carries the tone, but the dot + text together (never color alone) are what communicate meaning. */
export function Badge({
  children,
  color = 'gray',
  title,
}: {
  children: ReactNode;
  color?: keyof typeof COLORS;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] leading-none tracking-wide whitespace-nowrap uppercase ${COLORS[color]} ${title ? 'cursor-help' : ''}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_COLORS[color]}`} aria-hidden="true" />
      {children}
    </span>
  );
}
