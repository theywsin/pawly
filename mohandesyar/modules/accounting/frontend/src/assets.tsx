import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Building } from 'lucide-react';
import { Badge, Button, Card, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, MoneyInput, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { todayIso, toJalali } from '@mohandesyar/persian';
import { AccountSelect, DetailSelect, ErrorBanner, Nav, fieldErrors, onFail, rial, useApi, useCanDo, useRefresh } from './common.js';

interface Asset { id: string; code: string; name: string; category: string; acquired_on: string; cost: string; salvage: string; method: string; useful_life_months: number | null; rate_percent: number | null; status: string; disposed_on: string | null; accumulated: string; last_period: string | null }

const currentPeriod = () => {
  const [y, m, d] = todayIso().split('-').map(Number) as [number, number, number];
  const j = toJalali(y, m, d);
  return `${j.jy}-${String(j.jm).padStart(2, '0')}`;
};

export function AssetsPage() {
  const a = useApi();
  const can = useCanDo();
  const refresh = useRefresh();
  const q = useQuery({ queryKey: ['accounting', 'assets'], queryFn: () => a.get<Asset[]>('/assets') });
  const [creating, setCreating] = useState(false);
  const [disposing, setDisposing] = useState<Asset | null>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const dep = useMutation({
    mutationFn: () => a.post<{ assets: number; total: string; voucherNumber: number | null }>('/assets/depreciation', { period }),
    onSuccess: (r) => (toast(r.assets ? `استهلاک ${r.assets.toLocaleString('fa-IR')} دارایی به مبلغ ${rial(r.total)} ریال ثبت شد (سند ${r.voucherNumber?.toLocaleString('fa-IR')})` : 'برای این ماه استهلاکی باقی نمانده است'), refresh()),
    onError: onFail,
  });
  return (
    <>
      <PageHeader title="دارایی‌های ثابت" actions={can.assets && <Button onClick={() => setCreating(true)}>دارایی جدید</Button>} />
      <Nav />
      {can.assets && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="ماه استهلاک (شمسی)" hint="مثلاً ۱۴۰۵-۰۷"><Input dir="ltr" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
            <Button loading={dep.isPending} onClick={() => dep.mutate()}>محاسبه و ثبت سند استهلاک ماه</Button>
            <p className="text-sm text-muted">استهلاک از ماه بعد از خرید شروع می‌شود و برای هر دارایی در هر ماه فقط یک بار ثبت می‌شود.</p>
          </div>
        </Card>
      )}
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Building className="size-8" />} title="هنوز دارایی ثابتی ثبت نشده است" />}>
        <ExportMenu filename="fixed-assets" title="دارایی‌های ثابت" rows={q.data} columns={[
          { header: 'کد', value: (x) => x.code }, { header: 'نام', value: (x) => x.name }, { header: 'گروه', value: (x) => x.category }, { header: 'تاریخ خرید', value: (x) => x.acquired_on },
          { header: 'بهای تمام‌شده', value: (x) => x.cost, kind: 'number' }, { header: 'استهلاک انباشته', value: (x) => x.accumulated, kind: 'number' },
          { header: 'ارزش دفتری', value: (x) => (BigInt(x.cost) - BigInt(x.accumulated)).toString(), kind: 'number' },
        ]} />
        <Table>
          <thead><tr><Th>کد</Th><Th>نام</Th><Th>خرید</Th><Th>روش</Th><Th>بها</Th><Th>استهلاک انباشته</Th><Th>ارزش دفتری</Th><Th>آخرین ماه</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((x) => (
              <tr key={x.id}>
                <Td>{x.code}</Td><Td className="font-medium">{x.name}{x.category && <span className="text-xs text-muted"> · {x.category}</span>}</Td><Td className="whitespace-nowrap"><DayText value={x.acquired_on} /></Td>
                <Td>{x.method === 'straight_line' ? `خط مستقیم ${x.useful_life_months?.toLocaleString('fa-IR')} ماه` : `نزولی ${x.rate_percent?.toLocaleString('fa-IR')}٪`}</Td>
                <Td className="tabular-nums">{rial(x.cost)}</Td><Td className="tabular-nums">{rial(x.accumulated)}</Td><Td className="tabular-nums">{rial(BigInt(x.cost) - BigInt(x.accumulated))}</Td>
                <Td>{x.last_period ?? '—'}</Td>
                <Td>{x.status === 'active' ? (can.assets ? <Button size="sm" variant="ghost" onClick={() => setDisposing(x)}>فروش / کنارگذاری</Button> : <Badge tone="success">فعال</Badge>) : <Badge tone="neutral">واگذارشده <DayText value={x.disposed_on} /></Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <AssetForm onClose={() => setCreating(false)} />}
      {disposing && <DisposeForm asset={disposing} onClose={() => setDisposing(null)} />}
    </>
  );
}

function AssetForm({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [v, setV] = useState({ code: '', name: '', category: '', cost: '', salvage: '', method: 'straight_line', usefulLifeMonths: '60', ratePercent: '25', openingDepreciation: '', assetAccountId: '', depreciationAccountId: '', expenseAccountId: '', paidFromAccountId: '', paidFromDetailId: '' });
  const [acquiredOn, setAcquiredOn] = useState<string | null>(todayIso());
  const m = useMutation({
    mutationFn: () => a.post('/assets', {
      ...v, acquiredOn, salvage: v.salvage || '0', openingDepreciation: v.openingDepreciation || '0',
      usefulLifeMonths: v.method === 'straight_line' ? Number(v.usefulLifeMonths) : null, ratePercent: v.method === 'declining' ? Number(v.ratePercent) : null,
      assetAccountId: v.assetAccountId || null, depreciationAccountId: v.depreciationAccountId || null, expenseAccountId: v.expenseAccountId || null, paidFromAccountId: v.paidFromAccountId || null, paidFromDetailId: v.paidFromDetailId || null,
    }),
    onSuccess: () => (toast('دارایی ثبت شد'), refresh(), onClose()),
  });
  const f = fieldErrors(m.error);
  const s = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="دارایی ثابت جدید" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={!acquiredOn} onClick={() => m.mutate()}>ثبت</Button></>}>
      <ErrorBanner error={m.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="کد" required error={f.code}><Input value={v.code} onChange={(e) => s('code')(e.target.value)} /></Field>
        <Field label="نام" required error={f.name}><Input value={v.name} onChange={(e) => s('name')(e.target.value)} /></Field>
        <Field label="گروه دارایی"><Input value={v.category} onChange={(e) => s('category')(e.target.value)} /></Field>
        <Field label="تاریخ خرید / بهره‌برداری" required><DateInput value={acquiredOn ?? undefined} onChange={setAcquiredOn} /></Field>
        <Field label="بهای تمام‌شده (ریال)" required error={f.cost}><MoneyInput value={v.cost} onChange={s('cost')} /></Field>
        <Field label="ارزش اسقاط (ریال)" error={f.salvage}><MoneyInput value={v.salvage} onChange={s('salvage')} /></Field>
        <Field label="روش استهلاک"><Select value={v.method} onChange={(e) => s('method')(e.target.value)}><option value="straight_line">خط مستقیم</option><option value="declining">نزولی</option></Select></Field>
        {v.method === 'straight_line'
          ? <Field label="عمر مفید (ماه)" required error={f.usefulLifeMonths}><Input dir="ltr" inputMode="numeric" value={v.usefulLifeMonths} onChange={(e) => s('usefulLifeMonths')(e.target.value)} /></Field>
          : <Field label="نرخ سالانه (درصد)" required error={f.ratePercent}><Input dir="ltr" inputMode="decimal" value={v.ratePercent} onChange={(e) => s('ratePercent')(e.target.value)} /></Field>}
        <Field label="استهلاک انباشته قبلی (ریال)" hint="برای دارایی‌هایی که پیش از این سامانه مستهلک شده‌اند"><MoneyInput value={v.openingDepreciation} onChange={s('openingDepreciation')} /></Field>
        <AccountSelect label="حساب دارایی" allowEmpty="ماشین‌آلات و تجهیزات (پیش‌فرض)" value={v.assetAccountId} onChange={s('assetAccountId')} />
        <AccountSelect label="حساب استهلاک انباشته" allowEmpty="پیش‌فرض" value={v.depreciationAccountId} onChange={s('depreciationAccountId')} />
        <AccountSelect label="حساب هزینه استهلاک" allowEmpty="پیش‌فرض" value={v.expenseAccountId} onChange={s('expenseAccountId')} />
        <AccountSelect label="ثبت سند خرید از حساب" allowEmpty="— سند خرید صادر نشود —" value={v.paidFromAccountId} onChange={s('paidFromAccountId')} />
        {v.paidFromAccountId && <DetailSelect allowEmpty="—" value={v.paidFromDetailId} onChange={s('paidFromDetailId')} />}
      </div>
    </Dialog>
  );
}

function DisposeForm({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [date, setDate] = useState<string | null>(todayIso());
  const [v, setV] = useState({ proceeds: '', accountId: '', detailId: '', note: '' });
  const m = useMutation({
    mutationFn: () => a.post<{ result: string }>(`/assets/${asset.id}/dispose`, { date, proceeds: v.proceeds || '0', accountId: v.accountId || null, detailId: v.detailId || null, note: v.note }),
    onSuccess: (r) => (toast(BigInt(r.result) >= 0n ? `سود واگذاری ${rial(r.result)} ریال ثبت شد` : `زیان واگذاری ${rial(-BigInt(r.result))} ریال ثبت شد`), refresh(), onClose()),
    onError: onFail,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`فروش یا کنارگذاری ${asset.name}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={!date} onClick={() => m.mutate()}>ثبت</Button></>}>
      <p className="mb-3 text-sm">ارزش دفتری: {rial(BigInt(asset.cost) - BigInt(asset.accumulated))} ریال. اگر استهلاک ماه جاری را می‌خواهید، پیش از واگذاری آن را ثبت کنید.</p>
      <div className="grid gap-4">
        <Field label="تاریخ" required><DateInput value={date ?? undefined} onChange={setDate} /></Field>
        <Field label="مبلغ فروش (ریال)" hint="برای کنارگذاری بدون فروش خالی بگذارید"><MoneyInput value={v.proceeds} onChange={(x) => setV({ ...v, proceeds: x })} /></Field>
        {v.proceeds && <AccountSelect label="دریافت مبلغ در حساب" required value={v.accountId} onChange={(x) => setV({ ...v, accountId: x })} />}
        {v.proceeds && <DetailSelect allowEmpty="—" value={v.detailId} onChange={(x) => setV({ ...v, detailId: x })} />}
        <Field label="توضیح"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
