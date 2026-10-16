import type { ModuleRequestContext, ReportResult } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { Projects } from './logic.js';

const STATUS: Record<string, string> = { planning: 'برنامه‌ریزی', active: 'در حال اجرا', on_hold: 'متوقف', completed: 'تکمیل‌شده', cancelled: 'لغوشده' };

/**
 * Status of the reader's projects on the run date (planned vs. actual progress on working days). The period
 * selects projects whose planned schedule overlaps it; projects without dates are always included.
 */
export async function statusReport(ctx: ModuleRequestContext, p: { from: string; to: string; filters: Record<string, string> }): Promise<ReportResult> {
  const status = p.filters.status as 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled' | undefined;
  const list = (await Projects.list(ctx, { status }, todayIso())) as unknown as {
    code: string; title: string; status: string; employer_name: string; planned_start: string | null; planned_finish: string | null; budget_amount: string | null;
    progress: { planned: number | null; actual: number | null }; delayed: boolean;
  }[];
  const rows = list.filter((x) => (!x.planned_start || x.planned_start <= p.to) && (!x.planned_finish || x.planned_finish >= p.from) && (!p.filters.delayed || x.delayed));
  return {
    columns: [
      { key: 'code', header: 'کد' }, { key: 'title', header: 'عنوان' }, { key: 'status', header: 'وضعیت' }, { key: 'employer', header: 'کارفرما' }, { key: 'start', header: 'شروع برنامه‌ای', kind: 'date' },
      { key: 'finish', header: 'پایان برنامه‌ای', kind: 'date' }, { key: 'planned', header: 'پیشرفت برنامه‌ای ٪', kind: 'number' }, { key: 'actual', header: 'پیشرفت واقعی ٪', kind: 'number' },
      { key: 'delayed', header: 'تأخیر' }, { key: 'budget', header: 'بودجه (ریال)', kind: 'number' },
    ],
    rows: rows.map((x) => ({
      code: x.code, title: x.title, status: STATUS[x.status] ?? x.status, employer: x.employer_name, start: x.planned_start, finish: x.planned_finish,
      planned: x.progress.planned, actual: x.progress.actual, delayed: x.delayed ? 'دارد' : '', budget: x.budget_amount,
    })),
  };
}
