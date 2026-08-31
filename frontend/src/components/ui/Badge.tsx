import type { ReactNode } from 'react';

/**
 * Compact status tag. Solid fills on white, in the Patriots palette - navy for
 * neutral/brand, red for negative, dark green for positive. Tight and square
 * so it sits inside a dense table row without inflating the line height.
 *
 * The dot is kept alongside the label so tone is never carried by color alone.
 */
const COLORS: Record<string, string> = {
  green: 'bg-[#e6f2ea] text-[#0c4d2c] border-[#b6d8c4]',
  greenDark: 'bg-[#0f5c35] text-white border-[#0f5c35]',
  red: 'bg-[#fdeaee] text-[#85091f] border-[#f0c9d1]',
  yellow: 'bg-[#fdf3e0] text-[#7a5100] border-[#ecd9ae]',
  orange: 'bg-[#fdf0e4] text-[#8a4b00] border-[#eed3b4]',
  blue: 'bg-[#eaeff5] text-[#002244] border-[#c2d0e0]',
  purple: 'bg-[#002244] text-white border-[#002244]',
  gray: 'bg-[#eef0f2] text-[#3a4652] border-[#dfe3e8]',
};

const DOT_COLORS: Record<string, string> = {
  green: 'bg-[#12693d]',
  greenDark: 'bg-white',
  red: 'bg-[#c60c30]',
  yellow: 'bg-[#8a5c00]',
  orange: 'bg-[#8a4b00]',
  blue: 'bg-[#002244]',
  purple: 'bg-white',
  gray: 'bg-[#6b757f]',
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
      className={`inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold tracking-wide whitespace-nowrap uppercase ${COLORS[color]} ${title ? 'cursor-help' : ''}`}
    >
      <span className={`h-1 w-1 shrink-0 rounded-full ${DOT_COLORS[color]}`} aria-hidden="true" />
      {children}
    </span>
  );
}
