import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, DateInput, DayText, ExportMenu, Field, PageHeader, PageState, Select, Stat, Table, Tabs, Td, Th } from '@mohandesyar/ui';
import { todayIso, toJalali } from '@mohandesyar/persian';
import { AccountSelect, BASE, DetailSelect, Nav, rial, side, useApi, useRange } from './common.js';

export function ReportsPage() {
  const [tab, setTab] = useState('trial');
  return (
    <>
      <PageHeader title="دفاتر و گزارش‌های مالی" actions={<Button variant="secondary" className="print:hidden" onClick={() => window.print()}>چاپ / PDF</Button>} />
      <Nav />
      <div className="print:hidden">
        <Tabs label="گزارش‌ها" value={tab} onChange={setTab} items={[
          { key: 'trial', label: 'تراز آزمایشی' },
          { key: 'ledger', label: 'دفتر حساب و تفصیلی' },
          { key: 'journal', label: 'دفتر روزنامه' },
          { key: 'balance', label: 'ترازنامه' },
          { key: 'income', label: 'سود و زیان' },
          { key: 'parties', label: 'مانده طرف‌حساب‌ها' },
          { key: 'vat', label: 'ارزش افزوده فصلی' },
        ]} />
      </div>
      <div className="mt-4">
        {tab === 'trial' && <TrialBalance />}
        {tab === 'ledger' && <Ledger />}
        {tab === 'journal' && <Journal />}
        {tab === 'balance' && <BalanceSheet />}
        {tab === 'income' && <IncomeStatement />}
        {tab === 'parties' && <Parties />}
        {tab === 'vat' && <Vat />}
      </div>
    </>
  );
}

interface TrialRow { id: string; code: string; name: string; level: string; detail?: { id: string; code: string; name: string } | null; opening: string; debit: string; credit: string; balance: string }
const pos = (v: string) => (BigInt(v) > 0n ? rial(v) : '');
const neg = (v: string) => (BigInt(v) < 0n ? rial(-BigInt(v)) : '');

function TrialBalance() {
  const a = useApi();
  const r = useRange();
  const [level, setLevel] = useState('ledger');
  const q = useQuery({ queryKey: ['accounting', 'trial', r.from, r.to, level], enabled: r.ok, queryFn: () => a.get<{ rows: TrialRow[]; totals: Omit<TrialRow, 'id' | 'code' | 'name' | 'level'> }>(`/reports/trial-balance?from=${r.from}&to=${r.to}&level=${level}`) });
  const name = (x: TrialRow) => (x.detail ? `${x.name} / ${x.detail.name}` : x.name);
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        {r.picker}
        <div className="mb-4"><Field label="سطح"><Select value={level} onChange={(e) => setLevel(e.target.value)}><option value="group">گروه</option><option value="ledger">کل</option><option value="subsidiary">معین</option><option value="detail">معین و تفصیلی</option></Select></Field></div>
      </div>
      <PageState query={q} isEmpty={q.data?.rows.length === 0} empty={<p className="text-sm text-muted">در این بازه گردشی نیست.</p>}>
        {q.data && (
          <>
            <ExportMenu filename="trial-balance" title="تراز آزمایشی" rows={q.data.rows} columns={[
              { header: 'کد', value: (x) => x.code },
              { header: 'حساب', value: name },
              { header: 'مانده ابتدای دوره', value: (x) => x.opening, kind: 'number' },
              { header: 'گردش بدهکار', value: (x) => x.debit, kind: 'number' },
              { header: 'گردش بستانکار', value: (x) => x.credit, kind: 'number' },
              { header: 'مانده بدهکار', value: (x) => (BigInt(x.balance) > 0n ? x.balance : '0'), kind: 'number' },
              { header: 'مانده بستانکار', value: (x) => (BigInt(x.balance) < 0n ? (-BigInt(x.balance)).toString() : '0'), kind: 'number' },
            ]} />
            <Table>
              <thead><tr><Th>کد</Th><Th>حساب</Th><Th>مانده ابتدا</Th><Th>گردش بدهکار</Th><Th>گردش بستانکار</Th><Th>مانده بدهکار</Th><Th>مانده بستانکار</Th></tr></thead>
              <tbody>
                {q.data.rows.map((x) => (
                  <tr key={`${x.id}:${x.detail?.id ?? ''}`}>
                    <Td className="tabular-nums">{x.code}</Td><Td>{name(x)}</Td><Td className="whitespace-nowrap tabular-nums">{side(x.opening)}</Td>
                    <Td className="tabular-nums">{rial(x.debit)}</Td><Td className="tabular-nums">{rial(x.credit)}</Td><Td className="tabular-nums">{pos(x.balance)}</Td><Td className="tabular-nums">{neg(x.balance)}</Td>
                  </tr>
                ))}
                <tr className="font-bold"><Td colSpan={2}>جمع</Td><Td>{side(q.data.totals.opening)}</Td><Td className="tabular-nums">{rial(q.data.totals.debit)}</Td><Td className="tabular-nums">{rial(q.data.totals.credit)}</Td><Td colSpan={2}>{q.data.totals.balance === '0' ? 'تراز است' : <span className="text-danger">اختلاف {side(q.data.totals.balance)}</span>}</Td></tr>
              </tbody>
            </Table>
          </>
        )}
      </PageState>
    </>
  );
}

interface LedgerLine { voucher_id: string; number: number; date: string; voucher_description: string; account_code: string; account_name: string; detail_name: string | null; description: string; debit: string; credit: string; balance: string }

function Ledger() {
  const a = useApi();
  const r = useRange();
  const [accountId, setAccountId] = useState('');
  const [detailId, setDetailId] = useState('');
  const enabled = r.ok && !!(accountId || detailId);
  const qs = `from=${r.from}&to=${r.to}${accountId ? `&accountId=${accountId}` : ''}${detailId ? `&detailId=${detailId}` : ''}`;
  const q = useQuery({ queryKey: ['accounting', 'ledger', qs], enabled, queryFn: () => a.get<{ opening: string; lines: LedgerLine[]; closing: string }>(`/reports/ledger?${qs}`) });
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        {r.picker}
        <div className="mb-4 min-w-64"><AccountSelect label="حساب (گروه، کل یا معین)" levels={['group', 'ledger', 'subsidiary']} allowEmpty="— همه حساب‌ها —" value={accountId} onChange={setAccountId} /></div>
        <div className="mb-4 min-w-64"><DetailSelect allowEmpty="— بدون فیلتر تفصیلی —" value={detailId} onChange={setDetailId} /></div>
      </div>
      {!enabled ? <Alert tone="info">حساب یا تفصیلی را انتخاب کنید.</Alert> : (
        <PageState query={q}>
          {q.data && (
            <>
              <ExportMenu filename="ledger" title="دفتر حساب" rows={q.data.lines} columns={[
                { header: 'تاریخ', value: (x) => x.date }, { header: 'سند', value: (x) => x.number, kind: 'number' }, { header: 'حساب', value: (x) => `${x.account_code} ${x.account_name}` },
                { header: 'تفصیلی', value: (x) => x.detail_name ?? '' }, { header: 'شرح', value: (x) => x.description || x.voucher_description },
                { header: 'بدهکار', value: (x) => x.debit, kind: 'number' }, { header: 'بستانکار', value: (x) => x.credit, kind: 'number' }, { header: 'مانده', value: (x) => x.balance, kind: 'number' },
              ]} />
              <Table>
                <thead><tr><Th>تاریخ</Th><Th>سند</Th><Th>حساب</Th><Th>تفصیلی</Th><Th>شرح</Th><Th>بدهکار</Th><Th>بستانکار</Th><Th>مانده</Th></tr></thead>
                <tbody>
                  <tr className="font-medium"><Td colSpan={7}>مانده ابتدای دوره</Td><Td className="whitespace-nowrap">{side(q.data.opening)}</Td></tr>
                  {q.data.lines.map((x, i) => (
                    <tr key={i}>
                      <Td className="whitespace-nowrap"><DayText value={x.date} /></Td>
                      <Td><Link to={`${BASE}/vouchers/${x.voucher_id}`} className="text-primary underline">{x.number.toLocaleString('fa-IR')}</Link></Td>
                      <Td className="whitespace-nowrap">{x.account_code} {x.account_name}</Td><Td>{x.detail_name ?? '—'}</Td><Td>{x.description || x.voucher_description}</Td>
                      <Td className="tabular-nums">{x.debit === '0' ? '' : rial(x.debit)}</Td><Td className="tabular-nums">{x.credit === '0' ? '' : rial(x.credit)}</Td><Td className="whitespace-nowrap tabular-nums">{side(x.balance)}</Td>
                    </tr>
                  ))}
                  <tr className="font-bold"><Td colSpan={7}>مانده پایان دوره</Td><Td className="whitespace-nowrap">{side(q.data.closing)}</Td></tr>
                </tbody>
              </Table>
            </>
          )}
        </PageState>
      )}
    </>
  );
}

/** Journal (دفتر روزنامه): every posted line of the range in voucher order — the ledger without an account filter. */
function Journal() {
  const a = useApi();
  const r = useRange();
  const groups = useQuery({ queryKey: ['accounting', 'accounts-groups'], queryFn: () => a.get<{ id: string; level: string }[]>('/accounts') });
  const ids = (groups.data ?? []).filter((x) => x.level === 'group').map((x) => x.id);
  const q = useQuery({
    queryKey: ['accounting', 'journal', r.from, r.to, ids.join()],
    enabled: r.ok && ids.length > 0,
    queryFn: async () => {
      const parts = await Promise.all(ids.map((id) => a.get<{ lines: LedgerLine[] }>(`/reports/ledger?from=${r.from}&to=${r.to}&accountId=${id}`)));
      return parts.flatMap((p) => p.lines).sort((x, y) => (x.date === y.date ? x.number - y.number : x.date.localeCompare(y.date)));
    },
  });
  return (
    <>
      {r.picker}
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">در این بازه سند قطعی نیست.</p>}>
        <ExportMenu filename="journal" title="دفتر روزنامه" rows={q.data} columns={[
          { header: 'تاریخ', value: (x) => x.date }, { header: 'سند', value: (x) => x.number, kind: 'number' }, { header: 'حساب', value: (x) => `${x.account_code} ${x.account_name}` },
          { header: 'شرح', value: (x) => x.description || x.voucher_description }, { header: 'بدهکار', value: (x) => x.debit, kind: 'number' }, { header: 'بستانکار', value: (x) => x.credit, kind: 'number' },
        ]} />
        <Table>
          <thead><tr><Th>تاریخ</Th><Th>سند</Th><Th>حساب</Th><Th>شرح</Th><Th>بدهکار</Th><Th>بستانکار</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((x, i) => (
              <tr key={i}>
                <Td className="whitespace-nowrap"><DayText value={x.date} /></Td><Td>{x.number.toLocaleString('fa-IR')}</Td><Td>{x.account_code} {x.account_name}{x.detail_name ? ` / ${x.detail_name}` : ''}</Td>
                <Td>{x.description || x.voucher_description}</Td><Td className="tabular-nums">{x.debit === '0' ? '' : rial(x.debit)}</Td><Td className="tabular-nums">{x.credit === '0' ? '' : rial(x.credit)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}

interface Sec { code: string; name: string; amount: string }
function SectionTable({ title, rows, total }: { title: string; rows: Sec[]; total: string }) {
  return (
    <Card>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <Table>
        <tbody>
          {rows.map((x) => <tr key={x.code + x.name}><Td className="tabular-nums">{x.code}</Td><Td>{x.name}</Td><Td className="tabular-nums">{rial(x.amount)}</Td></tr>)}
          <tr className="font-bold"><Td colSpan={2}>جمع {title}</Td><Td className="tabular-nums">{rial(total)}</Td></tr>
        </tbody>
      </Table>
    </Card>
  );
}

function BalanceSheet() {
  const a = useApi();
  const [to, setTo] = useState<string | null>(todayIso());
  const q = useQuery({ queryKey: ['accounting', 'bs', to], enabled: !!to, queryFn: () => a.get<{ assets: Sec[]; liabilities: Sec[]; equity: Sec[]; totals: { assets: string; liabilities: string; equity: string } }>(`/reports/balance-sheet?to=${to}`) });
  return (
    <>
      <div className="mb-4 print:hidden"><Field label="تا تاریخ"><DateInput value={to ?? undefined} onChange={setTo} /></Field></div>
      <PageState query={q}>
        {q.data && (
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionTable title="دارایی‌ها" rows={q.data.assets} total={q.data.totals.assets} />
            <div className="space-y-4">
              <SectionTable title="بدهی‌ها" rows={q.data.liabilities} total={q.data.totals.liabilities} />
              <SectionTable title="حقوق مالکانه" rows={q.data.equity} total={q.data.totals.equity} />
              <p className="font-bold">جمع بدهی‌ها و حقوق مالکانه: {rial(BigInt(q.data.totals.liabilities) + BigInt(q.data.totals.equity))}</p>
            </div>
          </div>
        )}
      </PageState>
    </>
  );
}

function IncomeStatement() {
  const a = useApi();
  const r = useRange();
  const q = useQuery({ queryKey: ['accounting', 'is', r.from, r.to], enabled: r.ok, queryFn: () => a.get<{ income: Sec[]; expense: Sec[]; totals: { income: string; expense: string; result: string } }>(`/reports/income-statement?from=${r.from}&to=${r.to}`) });
  return (
    <>
      {r.picker}
      <PageState query={q}>
        {q.data && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="درآمدها">{rial(q.data.totals.income)}</Stat>
              <Stat label="بهای تمام‌شده و هزینه‌ها">{rial(q.data.totals.expense)}</Stat>
              <Stat label={BigInt(q.data.totals.result) >= 0n ? 'سود دوره' : 'زیان دوره'}>{rial(BigInt(q.data.totals.result) < 0n ? -BigInt(q.data.totals.result) : q.data.totals.result)}</Stat>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionTable title="درآمدها" rows={q.data.income} total={q.data.totals.income} />
              <SectionTable title="بهای تمام‌شده و هزینه‌ها" rows={q.data.expense} total={q.data.totals.expense} />
            </div>
          </div>
        )}
      </PageState>
    </>
  );
}

interface Party { id: string; code: string; name: string; receivable: string; cheques_receivable: string; payable: string; cheques_payable: string; prepayment: string; advance: string }
function Parties() {
  const a = useApi();
  const [to, setTo] = useState<string | null>(todayIso());
  const q = useQuery({ queryKey: ['accounting', 'parties', to], enabled: !!to, queryFn: () => a.get<Party[]>(`/reports/parties?to=${to}`) });
  return (
    <>
      <div className="mb-4 print:hidden"><Field label="تا تاریخ"><DateInput value={to ?? undefined} onChange={setTo} /></Field></div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">طرف‌حسابی مانده ندارد.</p>}>
        <ExportMenu filename="party-balances" title="مانده طرف‌حساب‌ها" rows={q.data} columns={[
          { header: 'کد', value: (x) => x.code }, { header: 'نام', value: (x) => x.name },
          { header: 'دریافتنی', value: (x) => x.receivable, kind: 'number' }, { header: 'چک‌های دریافتنی', value: (x) => x.cheques_receivable, kind: 'number' },
          { header: 'پرداختنی', value: (x) => x.payable, kind: 'number' }, { header: 'چک‌های پرداختنی', value: (x) => x.cheques_payable, kind: 'number' },
          { header: 'پیش‌پرداخت', value: (x) => x.prepayment, kind: 'number' }, { header: 'پیش‌دریافت', value: (x) => x.advance, kind: 'number' },
        ]} />
        <Table>
          <thead><tr><Th>طرف حساب</Th><Th>دریافتنی</Th><Th>چک دریافتنی</Th><Th>پرداختنی</Th><Th>چک پرداختنی</Th><Th>پیش‌پرداخت</Th><Th>پیش‌دریافت</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((x) => (
              <tr key={x.id}>
                <Td>{x.name} <span className="text-xs text-muted">({x.code})</span></Td>
                {[x.receivable, x.cheques_receivable, x.payable, x.cheques_payable, x.prepayment, x.advance].map((v, i) => <Td key={i} className={`tabular-nums ${BigInt(v) < 0n ? 'text-danger' : ''}`}>{v === '0' ? '' : rial(v)}</Td>)}
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}

interface VatParty { side: string; detail_id: string; name: string; national_id: string; economic_code: string; postal_code: string; address: string; invoices: number; amount: string; vat: string }
function Vat() {
  const a = useApi();
  const [gy, gm, gd] = todayIso().split('-').map(Number) as [number, number, number];
  const j = toJalali(gy, gm, gd);
  const [year, setYear] = useState(String(j.jy));
  const [season, setSeason] = useState(String(Math.ceil(j.jm / 3)));
  const q = useQuery({ queryKey: ['accounting', 'vat', year, season], queryFn: () => a.get<{ from: string; to: string; sales: { amount: string; vat: string }; purchases: { amount: string; vat: string }; payable: string; parties: VatParty[] }>(`/reports/vat?year=${year}&season=${season}`) });
  const cols = [
    { header: 'نوع', value: (x: VatParty) => (x.side === 'sale' ? 'فروش' : 'خرید') },
    { header: 'نام طرف معامله', value: (x: VatParty) => x.name },
    { header: 'شناسه/کد ملی', value: (x: VatParty) => x.national_id },
    { header: 'کد اقتصادی', value: (x: VatParty) => x.economic_code },
    { header: 'کد پستی', value: (x: VatParty) => x.postal_code },
    { header: 'نشانی', value: (x: VatParty) => x.address },
    { header: 'تعداد فاکتور', value: (x: VatParty) => x.invoices, kind: 'number' as const },
    { header: 'مبلغ معامله (ریال)', value: (x: VatParty) => x.amount, kind: 'number' as const },
    { header: 'مالیات و عوارض ارزش افزوده (ریال)', value: (x: VatParty) => x.vat, kind: 'number' as const },
  ];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <Field label="سال"><Select value={year} onChange={(e) => setYear(e.target.value)}>{[j.jy - 2, j.jy - 1, j.jy].map((y) => <option key={y} value={y}>{y.toLocaleString('fa-IR', { useGrouping: false })}</option>)}</Select></Field>
        <Field label="فصل"><Select value={season} onChange={(e) => setSeason(e.target.value)}><option value="1">بهار</option><option value="2">تابستان</option><option value="3">پاییز</option><option value="4">زمستان</option></Select></Field>
      </div>
      <PageState query={q}>
        {q.data && (
          <div className="space-y-4">
            <p className="text-sm text-muted">بازه: <DayText value={q.data.from} /> تا <DayText value={q.data.to} /> — فقط فاکتورهای تأییدشده؛ برگشتی‌ها کسر شده‌اند.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="فروش و مالیات فروش" hint={`مبلغ ${rial(q.data.sales.amount)}`}>{rial(q.data.sales.vat)}</Stat>
              <Stat label="خرید و مالیات خرید (اعتبار)" hint={`مبلغ ${rial(q.data.purchases.amount)}`}>{rial(q.data.purchases.vat)}</Stat>
              <Stat label={BigInt(q.data.payable) >= 0n ? 'مالیات قابل پرداخت' : 'مالیات قابل استرداد/انتقال'}>{rial(BigInt(q.data.payable) < 0n ? -BigInt(q.data.payable) : q.data.payable)}</Stat>
            </div>
            <h3 className="font-semibold">فهرست معاملات فصلی (به تفکیک طرف معامله)</h3>
            {q.data.parties.some((p) => !p.economic_code && !p.national_id) && <Alert tone="warning">برای برخی طرف‌ها کد اقتصادی یا شناسه ملی ثبت نشده است؛ پیش از ارسال گزارش، اطلاعات آن‌ها را در «حساب‌ها و تنظیمات ← تفصیلی‌ها» تکمیل کنید.</Alert>}
            <ExportMenu filename={`vat-${year}-${season}`} title="گزارش فصلی معاملات و ارزش افزوده" rows={q.data.parties} columns={cols} />
            <Table>
              <thead><tr>{cols.map((c) => <Th key={c.header}>{c.header}</Th>)}</tr></thead>
              <tbody>{q.data.parties.map((p) => <tr key={p.side + p.detail_id}>{cols.map((c) => <Td key={c.header} className={c.kind ? 'tabular-nums' : ''}>{c.kind ? rial(String(c.value(p))) : String(c.value(p) || '—')}</Td>)}</tr>)}</tbody>
            </Table>
          </div>
        )}
      </PageState>
    </>
  );
}
