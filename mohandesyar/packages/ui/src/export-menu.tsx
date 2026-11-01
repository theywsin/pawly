import { FileSpreadsheet, Printer } from 'lucide-react';
import { Button } from './button.js';
import { downloadBlob, toCsv, toXlsx, type ExportColumn } from './export.js';

/**
 * Excel / CSV / print for a list already on screen. Printing uses the print stylesheet (navigation
 * hidden, RTL, embedded Vazirmatn), so "Save as PDF" in the print dialog gives a correct Persian PDF.
 */
export function ExportMenu<T>({ filename, title, columns, rows }: { filename: string; title: string; columns: ExportColumn<T>[]; rows: T[] | undefined }) {
  const disabled = !rows?.length;
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => downloadBlob(`${filename}.xlsx`, toXlsx(title, columns, rows!) as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>
        <FileSpreadsheet className="size-4" /> Excel
      </Button>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => downloadBlob(`${filename}.csv`, toCsv(columns, rows!), 'text/csv;charset=utf-8')}>
        CSV
      </Button>
      <Button size="sm" variant="secondary" onClick={() => window.print()}>
        <Printer className="size-4" /> چاپ / PDF
      </Button>
    </div>
  );
}
