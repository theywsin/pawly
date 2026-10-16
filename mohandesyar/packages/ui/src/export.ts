// Pure writers live in @mohandesyar/export so the API can produce the same files for scheduled reports.
export { toCsv, toXlsx, zipStore, crc32, type ExportColumn } from '@mohandesyar/export';

export function downloadBlob(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
