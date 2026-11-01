import type { ReactNode } from 'react';
import { formatDate, formatNumber, formatRelative, type DigitStyle } from '@mohandesyar/persian';

/** Jalali date wrapped in <bdi> so mixed RTL/LTR content does not reorder. */
export function DateText({ value, withTime, digits, relative }: { value: string | Date | null | undefined; withTime?: boolean; digits?: DigitStyle; relative?: boolean }) {
  if (!value) return <span className="text-muted">—</span>;
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={iso} title={formatDate(value, { withTime: true, digits })}>
      <bdi>{relative ? formatRelative(value) : formatDate(value, { withTime, digits })}</bdi>
    </time>
  );
}

export function Num({ value, digits }: { value: number | string | bigint; digits?: DigitStyle }) {
  return <bdi className="tabular-nums">{formatNumber(value, { digits })}</bdi>;
}

/** Codes, emails, IDs: always left-to-right. */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}
