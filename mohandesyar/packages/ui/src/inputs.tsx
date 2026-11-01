import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { formatMoney, formatNumber, isoToJalali, parseJalaliDate, toLatinDigits, toPersianDigits } from '@mohandesyar/persian';
import { cn } from './cn.js';
import { Input } from './form.js';

type BaseInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

/**
 * Jalali date entry. `value` and `onChange` use ISO calendar dates ("2024-08-02"); the user types
 * "۱۴۰۳/۰۵/۱۲". `onChange(null)` means the typed text is not a real date (show a form error), `''` means empty.
 */
export const DateInput = forwardRef<HTMLInputElement, BaseInput & { value: string | null | undefined; onChange: (iso: string | null) => void }>(function DateInput({ value, onChange, className, onBlur, ...rest }, ref) {
  const shown = (iso: string | null | undefined) => (iso ? toPersianDigits(isoToJalali(iso) ?? '') : '');
  const [text, setText] = useState(shown(value));
  useEffect(() => {
    // Follow external changes (form reset) without clobbering what the user is typing.
    if (value !== null && parseJalaliDate(text) !== (value || null)) setText(shown(value));
  }, [value]);
  return (
    <Input
      ref={ref}
      inputMode="numeric"
      placeholder="۱۴۰۳/۰۱/۱۵"
      autoComplete="off"
      className={cn('tabular-nums', className)}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        onChange(t.trim() === '' ? '' : parseJalaliDate(t));
      }}
      onBlur={(e) => {
        const iso = parseJalaliDate(text);
        if (iso) setText(shown(iso));
        onBlur?.(e);
      }}
      {...rest}
    />
  );
});

/** Rial amount entry with digit grouping. `value`/`onChange` carry the plain digit string ('' when empty). */
export const MoneyInput = forwardRef<HTMLInputElement, BaseInput & { value: string | null | undefined; onChange: (digits: string) => void; allowNegative?: boolean }>(function MoneyInput({ value, onChange, className, allowNegative, ...rest }, ref) {
  const v = value ?? '';
  const neg = v.startsWith('-');
  const digits = v.replace(/^-/, '');
  return (
    <div className="relative">
      <Input
        ref={ref}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        className={cn('pe-12 text-end tabular-nums', className)}
        value={digits ? `${neg ? '-' : ''}${formatNumber(digits, { digits: 'latn' })}` : neg ? '-' : ''}
        onChange={(e) => {
          const raw = toLatinDigits(e.target.value);
          const minus = allowNegative && raw.trim().startsWith('-');
          const d = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 19);
          onChange(d ? `${minus ? '-' : ''}${d}` : minus ? '-' : '');
        }}
        {...rest}
      />
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted" aria-hidden="true">
        ریال
      </span>
    </div>
  );
});

/** Rial amount shown in the tenant's preferred unit. */
export function Money({ value, unit = 'rial', className }: { value: string | number | bigint | null | undefined; unit?: 'rial' | 'toman'; className?: string }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
  return <bdi className={cn('tabular-nums', className)}>{formatMoney(value, { unit })}</bdi>;
}

/** Calendar date ("2024-08-02") shown in Jalali, with no time-zone shift. */
export function DayText({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted">—</span>;
  const j = isoToJalali(value);
  return (
    <time dateTime={value.slice(0, 10)}>
      <bdi>{j ? toPersianDigits(j) : value}</bdi>
    </time>
  );
}

/** Horizontal progress bar; with `planned`, shows the planned position as a marker for comparison. */
export function ProgressBar({ value, planned, label, tone = 'primary' }: { value: number; planned?: number | null; label: string; tone?: 'primary' | 'success' | 'warning' | 'danger' }) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const bar = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return (
    <div className="relative h-2.5 w-full rounded-full bg-surface-2" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamp(value))}>
      <div className={cn('h-full rounded-full', bar)} style={{ inlineSize: `${clamp(value)}%` }} />
      {planned !== undefined && planned !== null && (
        <div className="absolute -top-1 h-4.5 w-0.5 bg-text" style={{ insetInlineStart: `calc(${clamp(planned)}% - 1px)` }} title={`برنامه: ${toPersianDigits(Math.round(planned))}٪`} />
      )}
    </div>
  );
}

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number;
}

/** Accessible tab bar (arrow keys move between tabs). Panels are rendered by the caller with `tabPanelProps`. */
export function Tabs({ items, value, onChange, label }: { items: TabItem[]; value: string; onChange: (key: string) => void; label: string }) {
  const id = useId();
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    // RTL: ArrowLeft moves forward.
    const delta = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = items[(i + delta + items.length) % items.length]!;
    onChange(next.key);
    document.getElementById(`${id}-${next.key}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {items.map((t, i) => (
        <button
          key={t.key}
          id={`${id}-${t.key}`}
          role="tab"
          type="button"
          aria-selected={t.key === value}
          tabIndex={t.key === value ? 0 : -1}
          onKeyDown={(e) => onKey(e, i)}
          onClick={() => onChange(t.key)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', t.key === value ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text')}
        >
          {t.label}
          {t.count !== undefined && <span className="ms-1.5 rounded-full bg-surface-2 px-1.5 text-xs tabular-nums">{toPersianDigits(t.count)}</span>}
        </button>
      ))}
    </div>
  );
}

/** Small labelled figure for summaries ("مبلغ قرارداد", "پیشرفت واقعی"). */
export function Stat({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold">{children}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Label/value pairs for detail pages. */
export function DescriptionList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted">{it.label}</dt>
          <dd className="text-[0.9375rem]">{it.value ?? <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
