import writeXlsxFile from 'write-excel-file/browser';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** Money columns are given in paise and written as rupees with 2 decimals. */
  money?: boolean;
  width?: number;
}

/** Download rows as an Excel (.xlsx) file. */
export async function exportExcel<T>(fileName: string, sheet: string, rows: T[], columns: ExportColumn<T>[]) {
  const header = columns.map((c) => ({ value: c.header, fontWeight: 'bold' as const }));
  const data = rows.map((r) =>
    columns.map((c) => {
      const v = c.value(r);
      if (v === null || v === undefined || v === '') return null;
      if (c.money && typeof v === 'number') return { value: v / 100, type: Number, format: '#,##0.00' };
      return typeof v === 'number' ? { value: v, type: Number } : { value: String(v), type: String };
    }),
  );
  const blob = await writeXlsxFile([header, ...data] as never, {
    sheet: sheet.slice(0, 31),
    columns: columns.map((c) => ({ width: c.width ?? Math.max(12, Math.min(40, c.header.length + 4)) })),
    stickyRowsCount: 1,
  } as never).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
