import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, DateInput, DayText, EmptyState, ExportMenu, Field, PageHeader, PageState, Table, Td, Th } from '@mohandesyar/ui';
import { addDays, todayIso } from '@mohandesyar/persian';
import { BASE, Nav, num, rial, useApi, useProjects } from './common.js';

interface Report {
  bySupplier: { id: string; name: string; orders: number; amount: string }[];
  byProject: { projects_project_id: string | null; amount: string }[];
  byCategory: { name: string; amount: string }[];
  late: { id: string; number: number; supplier_name: string; expected_on: string; received_pct: number; days_late: number }[];
  performance: { id: string; name: string; orders: number; completed: number; on_time: number; rating: number | null }[];
}

export function ReportsPage() {
  const a = useApi();
  const projects = useProjects();
  const [from, setFrom] = useState<string | null>(addDays(todayIso(), -90));
  const [to, setTo] = useState<string | null>(todayIso());
  const q = useQuery({ queryKey: ['procurement', 'reports', from, to], queryFn: () => a.get<Report>(`/reports?from=${from}&to=${to}`), enabled: !!from && !!to });
  const pname = (id: string | null) => (id ? (projects.data?.find((p) => p.id === id)?.title ?? 'پروژه') : 'بدون پروژه');
  const d = q.data;
  return (
    <>
      <PageHeader title="گزارش‌های تدارکات" description="مبالغ از سفارش‌های تأییدشده یا بسته‌شده با تاریخ سفارش در بازه؛ تأخیرها وضعیت امروز است." />
      <Nav />
      <div className="mb-6 flex flex-wrap gap-4">
        <Field label="از تاریخ"><DateInput value={from} onChange={setFrom} /></Field>
        <Field label="تا تاریخ"><DateInput value={to} onChange={setTo} /></Field>
      </div>
      <PageState query={q}>
        {d && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="هزینه به تفکیک تأمین‌کننده" actions={<ExportMenu filename="spend-by-supplier" title="هزینه به تفکیک تأمین‌کننده" rows={d.bySupplier} columns={[{ header: 'تأمین‌کننده', value: (r) => r.name }, { header: 'سفارش', value: (r) => r.orders, kind: 'number' }, { header: 'مبلغ (ریال)', value: (r) => r.amount, kind: 'number' }]} />} />
              {d.bySupplier.length === 0 ? <EmptyState title="داده‌ای در این بازه نیست" /> : (
                <Table><thead><tr><Th>تأمین‌کننده</Th><Th>سفارش</Th><Th>مبلغ (ریال)</Th></tr></thead>
                  <tbody>{d.bySupplier.map((r) => <tr key={r.id}><Td>{r.name}</Td><Td className="tabular-nums">{num(r.orders)}</Td><Td className="tabular-nums">{rial(r.amount)}</Td></tr>)}</tbody></Table>
              )}
            </Card>
            <Card>
              <CardHeader title="هزینه به تفکیک پروژه و دسته" />
              {d.byProject.length === 0 ? <EmptyState title="داده‌ای در این بازه نیست" /> : (
                <>
                  <Table><thead><tr><Th>پروژه</Th><Th>مبلغ (ریال)</Th></tr></thead>
                    <tbody>{d.byProject.map((r) => <tr key={r.projects_project_id ?? 'none'}><Td>{pname(r.projects_project_id)}</Td><Td className="tabular-nums">{rial(r.amount)}</Td></tr>)}</tbody></Table>
                  <Table><thead><tr><Th>دسته</Th><Th>مبلغ (ریال)</Th></tr></thead>
                    <tbody>{d.byCategory.map((r) => <tr key={r.name}><Td>{r.name}</Td><Td className="tabular-nums">{rial(r.amount)}</Td></tr>)}</tbody></Table>
                </>
              )}
            </Card>
            <Card>
              <CardHeader title="سفارش‌های دارای تأخیر" />
              {d.late.length === 0 ? <EmptyState title="سفارش دارای تأخیری وجود ندارد" /> : (
                <Table><thead><tr><Th>سفارش</Th><Th>تأمین‌کننده</Th><Th>موعد</Th><Th>تأخیر</Th><Th>تحویل‌شده</Th></tr></thead>
                  <tbody>{d.late.map((o) => <tr key={o.id}><Td><Link className="text-primary underline" to={`${BASE}/orders/${o.id}`}>PO-{num(o.number)}</Link></Td><Td>{o.supplier_name}</Td><Td><DayText value={o.expected_on} /></Td><Td className="tabular-nums">{num(o.days_late)} روز</Td><Td className="tabular-nums">{num(o.received_pct)}٪</Td></tr>)}</tbody></Table>
              )}
            </Card>
            <Card>
              <CardHeader title="عملکرد تأمین‌کنندگان" />
              {d.performance.length === 0 ? <EmptyState title="داده‌ای در این بازه نیست" /> : (
                <Table><thead><tr><Th>تأمین‌کننده</Th><Th>سفارش</Th><Th>تکمیل</Th><Th>به‌موقع</Th><Th>امتیاز</Th></tr></thead>
                  <tbody>{d.performance.map((p) => <tr key={p.id}><Td>{p.name}</Td><Td className="tabular-nums">{num(p.orders)}</Td><Td className="tabular-nums">{num(p.completed)}</Td><Td className="tabular-nums">{p.completed ? `${num(Math.round((p.on_time / p.completed) * 100))}٪` : '—'}</Td><Td className="tabular-nums">{p.rating === null ? '—' : num(p.rating)}</Td></tr>)}</tbody></Table>
              )}
            </Card>
          </div>
        )}
      </PageState>
    </>
  );
}
