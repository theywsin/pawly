import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DateInput, DayText, Field, Input, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { isoToJalali, toPersianDigits } from '@mohandesyar/persian';
import { ApiError } from '@mohandesyar/module-sdk/web';
import { appApi } from '../../../lib/api.js';
import { useAppSession } from '../../../lib/session.js';

interface CalendarData {
  year: number;
  weeklyOff: number[];
  fixed: { date: string; title: string }[];
  holidays: { id: string; date: string; title: string; kind: 'official' | 'company' }[];
}

const WEEKDAYS: [number, string][] = [[6, 'شنبه'], [0, 'یکشنبه'], [1, 'دوشنبه'], [2, 'سه‌شنبه'], [3, 'چهارشنبه'], [4, 'پنجشنبه'], [5, 'جمعه']];

/** Organisation work calendar used for project scheduling (working days). */
export function Calendar() {
  const { me } = useAppSession();
  const canEdit = me.permissions.includes('core.settings.manage');
  const qc = useQueryClient();
  const [year, setYear] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['calendar', year], queryFn: () => appApi<CalendarData>(`/api/core/calendar${year ? `?year=${year}` : ''}`) });
  const [date, setDate] = useState<string | null>('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'official' | 'company'>('official');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['calendar'] });
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : 'انجام نشد', 'danger');
  const weekly = useMutation({ mutationFn: (weeklyOff: number[]) => appApi('/api/core/calendar/weekly-off', { method: 'PUT', body: { weeklyOff } }), onSuccess: () => (toast('روزهای تعطیل هفته ذخیره شد'), refresh()), onError: fail });
  const add = useMutation({
    mutationFn: () => appApi('/api/core/calendar/holidays', { method: 'POST', body: { date, title, kind } }),
    onSuccess: () => (toast('تعطیلی ثبت شد'), setDate(''), setTitle(''), refresh()),
    onError: fail,
  });
  const remove = useMutation({ mutationFn: (id: string) => appApi(`/api/core/calendar/holidays/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: fail });
  return (
    <>
      <PageHeader title="تقویم کاری" description="روزهای کاری در زمان‌بندی پروژه‌ها و محاسبه مهلت‌ها استفاده می‌شود." />
      <PageState query={q}>
        {q.data && (
          <div className="space-y-6">
            <Card>
              <CardHeader title="تعطیلی هفتگی" />
              <div className="flex flex-wrap gap-4 p-5">
                {WEEKDAYS.map(([d, l]) => (
                  <Checkbox key={d} label={l} disabled={!canEdit || weekly.isPending} checked={q.data.weeklyOff.includes(d)}
                    onChange={(e) => weekly.mutate(e.target.checked ? [...q.data!.weeklyOff, d] : q.data!.weeklyOff.filter((x) => x !== d))} />
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title={`تعطیلات رسمی ثابت سال ${toPersianDigits(q.data.year)}`} description="این روزها خودکار تعطیل حساب می‌شوند."
                actions={<div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setYear(q.data!.year - 1)}>سال قبل</Button>
                  <Button size="sm" variant="ghost" onClick={() => setYear(q.data!.year + 1)}>سال بعد</Button>
                </div>} />
              <ul className="grid gap-2 p-5 text-sm sm:grid-cols-2">
                {q.data.fixed.map((h) => <li key={h.date}><DayText value={h.date} /> — {h.title}</li>)}
              </ul>
            </Card>
            <Card>
              <CardHeader title="تعطیلات قمری و تعطیلات سازمان" />
              <div className="space-y-4 p-5">
                <Alert tone="info">تاریخ تعطیلات مذهبی (قمری) هر سال تغییر می‌کند و تاریخ رسمی آن با محاسبه یک روز اختلاف دارد؛ آن‌ها را از تقویم رسمی همان سال وارد کنید.</Alert>
                {canEdit && (
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="تاریخ" error={date === null ? 'تاریخ معتبر نیست' : undefined}><DateInput value={date ?? undefined} onChange={setDate} /></Field>
                    <Field label="عنوان"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
                    <Field label="نوع">
                      <Select value={kind} onChange={(e) => setKind(e.target.value as 'official' | 'company')}><option value="official">رسمی</option><option value="company">تعطیلی سازمان</option></Select>
                    </Field>
                    <Button loading={add.isPending} disabled={!date || title.trim().length < 2} onClick={() => add.mutate()}>افزودن</Button>
                  </div>
                )}
                {!q.data.holidays.length ? <p className="text-sm text-muted">تعطیلی‌ای ثبت نشده است.</p> : (
                  <Table>
                    <thead><tr><Th>تاریخ</Th><Th>عنوان</Th><Th>نوع</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                    <tbody>
                      {q.data.holidays.map((h) => (
                        <tr key={h.id}>
                          <Td><bdi>{toPersianDigits(isoToJalali(h.date) ?? h.date)}</bdi></Td><Td>{h.title}</Td><Td><Badge tone={h.kind === 'official' ? 'info' : 'neutral'}>{h.kind === 'official' ? 'رسمی' : 'سازمان'}</Badge></Td>
                          <Td>{canEdit && <Button size="sm" variant="ghost" onClick={() => remove.mutate(h.id)}>حذف</Button>}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            </Card>
          </div>
        )}
      </PageState>
    </>
  );
}
