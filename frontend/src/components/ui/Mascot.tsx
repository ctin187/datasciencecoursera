// ---------------------------------------------------------------------------
// Original pixel-art mascot - a small helmet glyph plus a state badge, both
// generated procedurally (oval/rect/triangle math) rather than hand-typed
// character grids. Not a copy of any commercial game's sprites; an abstract,
// geometric take on the "pixel helmet" asset the design brief calls out.
// Deliberately small and quiet - a corner accent, never a hero graphic, and
// never in the way of the number next to it.
// ---------------------------------------------------------------------------

export type MascotState = 'idle' | 'waiver' | 'trade' | 'draft' | 'confident' | 'danger' | 'benched' | 'championship';

type Cell = [number, number, string];

const GRID = 16;

function oval(cx: number, cy: number, rx: number, ry: number, color: string): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) cells.push([x, y, color]);
    }
  }
  return cells;
}

function ring(cx: number, cy: number, rx: number, ry: number, thickness: number, color: string): Cell[] {
  const outer = new Set(oval(cx, cy, rx, ry, color).map(([x, y]) => `${x},${y}`));
  const inner = new Set(oval(cx, cy, rx - thickness, ry - thickness, color).map(([x, y]) => `${x},${y}`));
  const cells: Cell[] = [];
  for (const key of outer) {
    if (!inner.has(key)) {
      const [x, y] = key.split(',').map(Number);
      cells.push([x, y, color]);
    }
  }
  return cells;
}

function rect(x0: number, y0: number, x1: number, y1: number, color: string): Cell[] {
  const cells: Cell[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push([x, y, color]);
  return cells;
}

function triangleUp(cx: number, topY: number, height: number, color: string): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < height; row++) {
    const half = row;
    for (let x = cx - half; x <= cx + half; x++) cells.push([x, topY + row, color]);
  }
  return cells;
}

function plus(cx: number, cy: number, arm: number, color: string): Cell[] {
  const cells: Cell[] = [];
  for (let i = -arm; i <= arm; i++) {
    cells.push([cx + i, cy, color]);
    cells.push([cx, cy + i, color]);
  }
  return cells;
}

/** Helmet: a shell ring, a facemask cage (three bars), and a center stripe - the shared base for every state. */
function helmet(accent: string): Cell[] {
  const shell = ring(7, 7, 6, 6, 2, accent);
  const stripe = rect(6, 1, 7, 12, accent).filter(([, y]) => y > 1 && y < 13);
  const cage = [...rect(9, 6, 13, 6, '#12141a'), ...rect(9, 8, 13, 8, '#12141a'), ...rect(9, 10, 13, 10, '#12141a')];
  return [...shell, ...stripe, ...cage];
}

function badgeFor(state: MascotState): { cells: Cell[]; color: string } {
  switch (state) {
    case 'waiver':
      return { cells: triangleUp(2, 10, 5, '#38bdf8'), color: '#38bdf8' }; // signal arrow
    case 'trade':
    case 'draft':
      return { cells: [...rect(0, 8, 5, 15, '#38bdf8').filter(([x, y]) => x === 0 || x === 5 || y === 8 || y === 15), ...rect(1, 10, 4, 10, '#38bdf8'), ...rect(1, 12, 3, 12, '#38bdf8')], color: '#38bdf8' }; // clipboard
    case 'confident':
      return { cells: plus(3, 12, 3, '#34d399'), color: '#34d399' }; // starburst
    case 'danger':
      return { cells: [...triangleUp(3, 8, 6, '#f87171'), ...rect(3, 11, 3, 11, '#0e1116'), rect(3, 13, 3, 13, '#0e1116')[0]], color: '#f87171' }; // warning triangle + exclamation
    case 'championship':
      return { cells: [...rect(0, 9, 6, 11, '#ffd700'), ...rect(2, 12, 4, 14, '#ffd700'), ...rect(1, 14, 5, 15, '#ffd700')], color: '#ffd700' }; // trophy
    case 'benched':
      return { cells: rect(0, 12, 6, 13, '#626d7a'), color: '#626d7a' }; // flat dash
    case 'idle':
    default:
      return { cells: oval(3, 11, 3, 2, '#a85f00'), color: '#a85f00' }; // football
  }
}

const GLOW: Record<MascotState, string> = {
  idle: 'drop-shadow(0 0 2px rgba(255,164,31,0.35))',
  waiver: 'drop-shadow(0 0 3px rgba(56,189,248,0.55))',
  trade: 'drop-shadow(0 0 3px rgba(56,189,248,0.55))',
  draft: 'drop-shadow(0 0 3px rgba(56,189,248,0.55))',
  confident: 'drop-shadow(0 0 4px rgba(52,211,153,0.6))',
  danger: 'drop-shadow(0 0 4px rgba(248,113,113,0.6))',
  benched: 'none',
  championship: 'drop-shadow(0 0 5px rgba(255,215,0,0.75))',
};

export function Mascot({ state = 'idle', size = 56, className = '' }: { state?: MascotState; size?: number; className?: string }) {
  const helmetCells = helmet('var(--color-violet-500)');
  const badge = badgeFor(state);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Team signal: ${state}`}
      className={className}
      style={{ filter: GLOW[state] }}
    >
      {helmetCells.map(([x, y, color], i) => (
        <rect key={`h${i}`} x={x} y={y} width={1} height={1} fill={color} />
      ))}
      {badge.cells.map(([x, y, color], i) => (
        <rect key={`b${i}`} x={x} y={y} width={1} height={1} fill={color} />
      ))}
      <title>{`Mascot: ${state}`}</title>
    </svg>
  );
}
