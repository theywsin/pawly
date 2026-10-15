import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, Dialog, EmptyState, Field, Input, Ltr, PageHeader, PageState, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { formatMoney } from '@mohandesyar/persian';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import type { ConsoleModule } from './Modules.js';

interface Plan {
  key: string;
  name: string;
  description: string;
  price_monthly: string | null;
  price_yearly: string | null;
  user_limit: number | null;
  storage_gb: number | null;
  is_public: boolean;
  sort: number;
  status: string;
  features: Record<string, unknown>;
  modules: { moduleId: string; included: boolean; addonPrice: string | null }[];
}

const KNOWN_MODULES = ['projects', 'crm', 'contracts', 'meetings', 'recruitment', 'hr', 'kpi', 'finance', 'procurement', 'documents', 'qhse', 'holding'];
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d]/g, '')));

function PlanEditor({ plan, onClose }: { plan: Plan | null; onClose(): void }) {
  const qc = useQueryClient();
  const installed = useQuery({ queryKey: ['console-modules'], queryFn: () => consoleApi<ConsoleModule[]>('/api/console/modules') });
  const [key, setKey] = useState(plan?.key ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [monthly, setMonthly] = useState(plan?.price_monthly ?? '');
  const [yearly, setYearly] = useState(plan?.price_yearly ?? '');
  const [users, setUsers] = useState(plan?.user_limit?.toString() ?? '');
  const [storage, setStorage] = useState(plan?.storage_gb?.toString() ?? '');
  const [isPublic, setPublic] = useState(plan?.is_public ?? true);
  const [sort, setSort] = useState(plan?.sort?.toString() ?? '0');
  const [signupDefault, setSignupDefault] = useState(!!plan?.features.signupDefault);
  const [trialDays, setTrialDays] = useState(plan?.features.trialDays ? String(plan.features.trialDays) : '');
  const [mods, setMods] = useState<Set<string>>(new Set(plan?.modules.filter((m) => m.included).map((m) => m.moduleId)));
  const ids = [...new Set([...(installed.data?.map((m) => m.id) ?? []), ...KNOWN_MODULES])];
  const save = useMutation({
    mutationFn: () =>
      consoleApi(`/api/console/plans/${key}`, {
        method: 'PUT',
        body: {
          name,
          description,
          priceMonthly: num(String(monthly)),
          priceYearly: num(String(yearly)),
          userLimit: num(users),
          storageGb: num(storage),
          isPublic,
          sort: Number(sort) || 0,
          features: { ...(plan?.features ?? {}), signupDefault, ...(trialDays ? { trialDays: Number(trialDays) } : { trialDays: undefined }) },
          modules: [...mods].map((moduleId) => ({ moduleId, included: true })),
        },
      }),
    onSuccess: () => {
      toast('پلن ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['plans'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={plan ? `ویرایش پلن «${plan.name}»` : 'پلن جدید'}
      footer={<Button loading={save.isPending} disabled={!key || !name} onClick={() => save.mutate()}>ذخیره</Button>}
    >
      <div className="grid max-h-[65dvh] gap-3 overflow-y-auto sm:grid-cols-2">
        <Field label="شناسه (لاتین)" hint="مثلاً basic">
          <Input dir="ltr" value={key} disabled={!!plan} onChange={(e) => setKey(e.target.value.toLowerCase())} />
        </Field>
        <Field label="نام">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="توضیح" className="sm:col-span-2">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="قیمت ماهانه (ریال)" hint="خالی = «تماس بگیرید»">
          <Input dir="ltr" inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </Field>
        <Field label="قیمت سالانه (ریال)">
          <Input dir="ltr" inputMode="numeric" value={yearly} onChange={(e) => setYearly(e.target.value)} />
        </Field>
        <Field label="سقف کاربر" hint="خالی = نامحدود">
          <Input dir="ltr" inputMode="numeric" value={users} onChange={(e) => setUsers(e.target.value)} />
        </Field>
        <Field label="فضای ذخیره (گیگابایت)">
          <Input dir="ltr" inputMode="numeric" value={storage} onChange={(e) => setStorage(e.target.value)} />
        </Field>
        <Field label="ترتیب نمایش">
          <Input dir="ltr" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
        </Field>
        <Field label="روزهای آزمایشی (ثبت‌نام)">
          <Input dir="ltr" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="نمایش در صفحه قیمت‌ها" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />
          <Checkbox label="پلن پیش‌فرض ثبت‌نام" checked={signupDefault} onChange={(e) => setSignupDefault(e.target.checked)} />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">ماژول‌های شامل این پلن</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {ids.map((id) => (
              <Checkbox
                key={id}
                label={<Ltr className="text-xs">{id}</Ltr>}
                checked={mods.has(id)}
                onChange={(e) => {
                  const s = new Set(mods);
                  if (e.target.checked) s.add(id);
                  else s.delete(id);
                  setMods(s);
                }}
              />
            ))}
          </div>
        </fieldset>
        {Number(monthly) > 0 && <Alert tone="info" className="sm:col-span-2">نمایش در سایت: {formatMoney(String(num(String(monthly))), { unit: 'toman' })} در ماه</Alert>}
      </div>
    </Dialog>
  );
}

export function Plans() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plans'], queryFn: () => consoleApi<Plan[]>('/api/console/plans') });
  const [editing, setEditing] = useState<Plan | null | 'new'>(null);
  const archive = useMutation({
    mutationFn: (p: Plan) => consoleApi(`/api/console/plans/${p.key}/archive`, { method: 'POST', body: { archived: p.status !== 'archived' } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plans'] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <>
      <PageHeader title="پلن‌ها" description="صفحه قیمت‌های سایت مستقیماً از همین پلن‌ها ساخته می‌شود." actions={<Button onClick={() => setEditing('new')}>پلن جدید</Button>} />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<CreditCard className="size-8" />} title="هنوز پلنی تعریف نشده است" description="تا وقتی پلنی منتشر نشده، صفحه قیمت‌ها کاربر را به درخواست دمو هدایت می‌کند." />}>
        <Table>
          <thead>
            <tr>
              <Th>پلن</Th>
              <Th>قیمت ماهانه</Th>
              <Th>کاربر</Th>
              <Th>ماژول‌ها</Th>
              <Th>وضعیت</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((p) => (
              <tr key={p.key}>
                <Td>
                  <span className="font-medium">{p.name}</span> <Ltr className="text-xs text-muted">{p.key}</Ltr>
                </Td>
                <Td>{p.price_monthly ? formatMoney(p.price_monthly, { unit: 'toman' }) : 'تماس بگیرید'}</Td>
                <Td>{p.user_limit ?? 'نامحدود'}</Td>
                <Td><Ltr className="text-xs">{p.modules.filter((m) => m.included).map((m) => m.moduleId).join(', ') || '—'}</Ltr></Td>
                <Td>
                  {p.status === 'archived' ? <Badge>بایگانی</Badge> : p.is_public ? <Badge tone="success">منتشرشده</Badge> : <Badge tone="info">خصوصی</Badge>}
                </Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>ویرایش</Button>{' '}
                  <Button size="sm" variant="ghost" onClick={() => archive.mutate(p)}>{p.status === 'archived' ? 'بازگردانی' : 'بایگانی'}</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <PlanEditor plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
