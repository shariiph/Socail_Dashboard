function escapeCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const keys = Object.keys(rows[0]);
  const header = keys.map(escapeCell).join(',');
  const lines = rows.map((r) => keys.map((k) => escapeCell(r[k])).join(','));
  return [header, ...lines].join('\r\n');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
