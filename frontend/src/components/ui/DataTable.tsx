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

  const alignOf = (a?: 'left' | 'right' | 'center') =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  return (
    <div className="panel-flush overflow-x-auto border border-[color:var(--rule)]">
      <div style={{ maxHeight }} className="overflow-y-auto">
        <table className="data-table min-w-full">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && toggleSort(col.key)}
                  className={`${alignOf(col.align)} ${col.sortable === false ? 'cursor-default' : ''}`}
                  aria-sort={
                    sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {col.header}
                  {sortKey === col.key && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`${alignOf(col.align)} ${col.align === 'right' ? 'num' : ''}`}
                  >
                    {col.render ? col.render(row) : col.accessor(row)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-muted">
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
