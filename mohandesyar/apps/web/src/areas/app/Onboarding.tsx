import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Badge, Button, Card, Field, Input, Select, toast } from '@mohandesyar/ui';
import { toLatinDigits, toPersianDigits } from '@mohandesyar/persian';
import { appApi } from '../../lib/api.js';
import { applyServerErrors, errorMessage } from '../../lib/errors.js';
import { useAppSession } from '../../lib/session.js';

const STEPS = ['اطلاعات شرکت', 'تنظیمات سازمان', 'ماژول‌ها', 'دعوت تیم'];

const companySchema = z.object({
  name: z.string().trim().min(2, 'نام شرکت الزامی است'),
  legalName: z.string().trim().optional(),
  nationalId: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{11}$/.test(toLatinDigits(v)), 'شناسه ملی شخص حقوقی باید ۱۱ رقم باشد'),
  economicCode: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

interface OnboardingData {
  completedAt: string | null;
  tenant: { name: string; timezone: string; number_style: 'fa' | 'latn' };
  company: { id: string; name: string; legal_name: string | null; national_id: string | null; economic_code: string | null; phone: string | null; address: string | null };
}

function CompanyStep({ data, onNext }: { data: OnboardingData; onNext(): void }) {
  const [error, setError] = useState<string | null>(null);
  const c = data.company;
  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: { name: c.name, legalName: c.legal_name ?? '', nationalId: c.national_id ?? '', economicCode: c.economic_code ?? '', phone: c.phone ?? '', address: c.address ?? '' },
  });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const blank = (x?: string) => (x ? x : null);
      await appApi(`/api/core/companies/${c.id}`, { method: 'PUT', body: { name: v.name, legalName: blank(v.legalName), nationalId: blank(v.nationalId), economicCode: blank(v.economicCode), phone: blank(v.phone), address: blank(v.address) } });
      onNext();
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });
  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
      <Field label="نام شرکت" error={e.name?.message} required>
        <Input {...form.register('name')} />
      </Field>
      <Field label="نام ثبتی">
        <Input {...form.register('legalName')} />
      </Field>
      <Field label="شناسه ملی" error={e.nationalId?.message} hint="۱۱ رقم؛ اختیاری">
        <Input dir="ltr" inputMode="numeric" {...form.register('nationalId')} />
      </Field>
      <Field label="کد اقتصادی">
        <Input dir="ltr" {...form.register('economicCode')} />
      </Field>
      <Field label="تلفن">
        <Input dir="ltr" type="tel" {...form.register('phone')} />
      </Field>
      <Field label="نشانی">
        <Input {...form.register('address')} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" loading={form.formState.isSubmitting}>
          ذخیره و ادامه
        </Button>
      </div>
    </form>
  );
}

function PreferencesStep({ data, onNext }: { data: OnboardingData; onNext(): void }) {
  const [name, setName] = useState(data.tenant.name);
  const [timezone, setTimezone] = useState(data.tenant.timezone);
  const [numberStyle, setNumberStyle] = useState(data.tenant.number_style);
  const save = useMutation({ mutationFn: () => appApi('/api/core/tenant', { method: 'PUT', body: { name, timezone, numberStyle } }), onSuccess: onNext, onError: (e) => toast(errorMessage(e), 'danger') });
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="نام سازمان" className="sm:col-span-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="منطقه زمانی">
        <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          <option value="Asia/Tehran">تهران (Asia/Tehran)</option>
          <option value="Asia/Dubai">دبی (Asia/Dubai)</option>
          <option value="Europe/Istanbul">استانبول (Europe/Istanbul)</option>
          <option value="UTC">UTC</option>
        </Select>
      </Field>
      <Field label="نمایش اعداد">
        <Select value={numberStyle} onChange={(e) => setNumberStyle(e.target.value as 'fa' | 'latn')}>
          <option value="fa">فارسی ({toPersianDigits('1405')})</option>
          <option value="latn">لاتین (1405)</option>
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" loading={save.isPending}>
          ذخیره و ادامه
        </Button>
      </div>
    </form>
  );
}

function ModulesStep({ onNext }: { onNext(): void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tenant-modules'], queryFn: () => appApi<{ id: string; name: { fa: string }; enabled: boolean; entitled: boolean; globally_enabled: boolean }[]>('/api/core/modules') });
  const toggle = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) => appApi(`/api/core/modules/${id}/${enable ? 'enable' : 'disable'}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-modules'] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const list = q.data?.filter((m) => m.globally_enabled) ?? [];
  return (
    <div className="space-y-4">
      {q.isPending ? (
        <p className="text-sm text-muted">در حال بارگذاری…</p>
      ) : list.length === 0 ? (
        <Alert tone="info">هنوز ماژولی روی این سامانه منتشر نشده است. پس از انتشار، از بخش «تنظیمات ← ماژول‌ها» فعالشان کنید.</Alert>
      ) : (
        <ul className="space-y-2">
          {list.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span>
                {m.name.fa} {!m.entitled && <Badge tone="warning">خارج از اشتراک</Badge>}
              </span>
              {m.entitled && (
                <Button size="sm" variant={m.enabled ? 'secondary' : 'primary'} loading={toggle.isPending} onClick={() => toggle.mutate({ id: m.id, enable: !m.enabled })}>
                  {m.enabled ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button onClick={onNext}>ادامه</Button>
    </div>
  );
}

function TeamStep({ onFinish, finishing }: { onFinish(): void; finishing: boolean }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [roleKey, setRoleKey] = useState('employee');
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => appApi<{ key: string; name: string }[]>('/api/core/roles') });
  const [added, setAdded] = useState<string[]>([]);
  const add = useMutation({
    mutationFn: () => appApi('/api/core/members', { method: 'POST', body: { email, fullName, roleKey, initialPassword: password || undefined, companyId: null } }),
    onSuccess: () => {
      setAdded([...added, fullName]);
      setEmail('');
      setFullName('');
      setPassword('');
      toast('همکار افزوده شد');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <div className="space-y-4">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="نام همکار">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="ایمیل">
          <Input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="نقش">
          <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            {roles.data?.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="رمز اولیه" hint="برای کاربر جدید؛ به‌صورت امن به او بدهید">
          <Input dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" loading={add.isPending} disabled={!email || fullName.length < 2}>
            افزودن همکار
          </Button>
        </div>
      </form>
      {added.length > 0 && <p className="text-sm text-muted">افزوده شد: {added.join('، ')}</p>}
      <Button onClick={onFinish} loading={finishing}>
        پایان و ورود به داشبورد
      </Button>
    </div>
  );
}

/** First-run wizard (prompt §5.11): company → preferences → modules → team. Every step can be revisited later in settings. */
export function Onboarding() {
  const { me } = useAppSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const q = useQuery({ queryKey: ['onboarding'], queryFn: () => appApi<OnboardingData>('/api/core/onboarding') });
  const finish = useMutation({
    mutationFn: () => appApi('/api/core/onboarding/complete', { method: 'POST' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/app', { replace: true });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (!me.permissions.includes('core.settings.manage')) return <Navigate to="/app" replace />;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">راه‌اندازی فضای کاری</h1>
      <p className="mt-1 text-sm text-muted">چند گام کوتاه برای آماده‌سازی سامانه. همه این موارد بعداً از تنظیمات قابل تغییرند.</p>
      <ol className="my-6 flex flex-wrap gap-2 text-sm" aria-label="مراحل راه‌اندازی">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={`rounded-full px-3 py-1 ${i === step ? 'bg-primary text-primary-fg' : i < step ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-muted'}`}>
            {toPersianDigits(i + 1)}. {s}
          </li>
        ))}
      </ol>
      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">{STEPS[step]}</h2>
        {q.isPending ? (
          <p className="text-sm text-muted">در حال بارگذاری…</p>
        ) : q.isError || !q.data ? (
          <Alert tone="danger">{errorMessage(q.error)}</Alert>
        ) : step === 0 ? (
          <CompanyStep data={q.data} onNext={() => setStep(1)} />
        ) : step === 1 ? (
          <PreferencesStep data={q.data} onNext={() => setStep(2)} />
        ) : step === 2 ? (
          <ModulesStep onNext={() => setStep(3)} />
        ) : (
          <TeamStep onFinish={() => finish.mutate()} finishing={finish.isPending} />
        )}
      </Card>
      <p className="mt-4 text-sm">
        <Link to="/app" onClick={() => finish.mutate()} className="text-muted underline">
          فعلاً رد شو
        </Link>
      </p>
    </main>
  );
}
