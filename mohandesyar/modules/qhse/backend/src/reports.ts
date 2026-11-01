import type { ModuleRequestContext, ReportResult } from '@mohandesyar/module-sdk/server';
import { Incidents, KIND_FA } from './logic.js';

const SEVERITY: Record<string, string> = { low: 'کم', medium: 'متوسط', high: 'زیاد', critical: 'بحرانی' };
const STATUS: Record<string, string> = { open: 'باز', investigating: 'در حال بررسی', closed: 'بسته' };

/** Incidents that occurred in the period, within the reader's scope (company or own projects). */
export async function incidentsReport(ctx: ModuleRequestContext, p: { from: string; to: string; filters: Record<string, string> }): Promise<ReportResult> {
  const list = (await Incidents.list(ctx, { kind: p.filters.kind })) as Record<string, string | number | boolean | null>[];
  const rows = list.filter((i) => String(i.occurred_on) >= p.from && String(i.occurred_on) <= p.to && (!p.filters.severity || i.severity === p.filters.severity));
  return {
    columns: [
      { key: 'number', header: 'شماره', kind: 'number' }, { key: 'date', header: 'تاریخ', kind: 'date' }, { key: 'kind', header: 'نوع' }, { key: 'severity', header: 'شدت' }, { key: 'title', header: 'عنوان' },
      { key: 'location', header: 'محل' }, { key: 'injured', header: 'مصدوم', kind: 'number' }, { key: 'lostDays', header: 'روز از دست رفته', kind: 'number' }, { key: 'status', header: 'وضعیت' },
    ],
    rows: rows.map((i) => ({
      number: Number(i.number), date: String(i.occurred_on), kind: KIND_FA[String(i.kind)] ?? String(i.kind), severity: SEVERITY[String(i.severity)] ?? null, title: String(i.title), location: String(i.location ?? ''),
      injured: Number(i.injured_count), lostDays: Number(i.lost_days), status: STATUS[String(i.status)] ?? null,
    })),
  };
}
