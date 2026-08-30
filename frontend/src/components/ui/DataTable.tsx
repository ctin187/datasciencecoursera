import { useMemo, useState } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => string | number;
  render?: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  defaultSortKey,
  defaultSortDir = 'desc',
  rowKey,
  maxHeight = 560,
}: {
  rows: T[];
  columns: Column<T>[];
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  rowKey: (row: T) => string;
  maxHeight?: number;
}) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = col.accessor(a);
      const bv = col.accessor(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <div className="arcade-panel overflow-x-auto rounded-md border-slate-700 bg-slate-950/40">
      <div style={{ maxHeight }} className="overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && toggleSort(col.key)}
                  className={`whitespace-nowrap border-b-2 border-slate-700 px-3 py-2 font-mono text-[11px] font-semibold tracking-wide text-slate-400 uppercase ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  } ${col.sortable !== false ? 'cursor-pointer select-none hover:text-violet-300' : ''}`}
                >
                  {col.header}
                  {sortKey === col.key && <span className="ml-1 text-violet-400">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={rowKey(row)} className="border-b border-slate-800/60 hover:bg-violet-500/[0.06]">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-3 py-2 text-slate-200 ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {col.render ? col.render(row) : col.accessor(row)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-500">
                  No data to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
