import type { ReactNode } from 'react';

const COLORS: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  greenDark: 'bg-emerald-600/25 text-emerald-300 border-emerald-500/50',
  red: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  yellow: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  blue: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  purple: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  gray: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

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
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${COLORS[color]} ${title ? 'cursor-help' : ''}`}
    >
      {children}
    </span>
  );
}
