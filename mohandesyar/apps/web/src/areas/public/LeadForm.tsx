import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Button, Field, Input, Select, Textarea } from '@mohandesyar/ui';

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'نام خود را وارد کنید'),
    company: z.string().trim().max(160).optional(),
    companySize: z.string().optional(),
    phone: z.string().trim().optional(),
    email: z.union([z.email('ایمیل معتبر نیست'), z.literal('')]).optional(),
    message: z.string().max(2000, 'پیام حداکثر ۲۰۰۰ نویسه است').optional(),
    website: z.string().optional(),
  })
  .refine((v) => !!v.phone?.trim() || !!v.email?.trim(), { path: ['phone'], message: 'تلفن یا ایمیل را وارد کنید' });
type Form = z.infer<typeof schema>;

/**
 * Demo / contact request. Stored by the platform (no third-party form or captcha service); the server
 * checks a signed form token, a honeypot field and rate limits.
 */
export function LeadForm({ kind }: { kind: 'demo' | 'contact' }) {
  const [token, setToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Form>({ resolver: zodResolver(schema) });
  const e = form.formState.errors;

  useEffect(() => {
    fetch('/api/public/form-token')
      .then((r) => r.json())
      .then((b: { token: string }) => setToken(b.token))
      .catch(() => setError('ارتباط با سرور برقرار نشد؛ صفحه را دوباره بارگذاری کنید'));
  }, []);

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    const body = { ...v, kind, formToken: token, companySize: v.companySize || undefined, email: v.email || undefined, phone: v.phone || undefined };
    const res = await fetch('/api/public/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) return setError('ارتباط با سرور برقرار نشد');
    if (res.ok) return setDone(true);
    const b = (await res.json().catch(() => ({}))) as { message?: string; details?: { path: string; message: string }[] };
    for (const d of b.details ?? []) form.setError(d.path as keyof Form, { message: d.message });
    setError(b.message ?? 'ارسال ممکن نشد');
  });

  if (done) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-lg border border-success/30 bg-success/10 p-8 text-center">
        <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
        <p className="font-semibold">درخواست شما ثبت شد.</p>
        <p className="text-sm text-muted">کارشناسان ما برای هماهنگی با شما تماس می‌گیرند.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="grid gap-4 rounded-lg border border-border bg-surface p-6 sm:grid-cols-2" aria-label={kind === 'demo' ? 'فرم درخواست دمو' : 'فرم تماس'}>
      {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
      <Field label="نام و نام خانوادگی" error={e.fullName?.message} required>
        <Input autoComplete="name" {...form.register('fullName')} />
      </Field>
      <Field label="نام شرکت">
        <Input autoComplete="organization" {...form.register('company')} />
      </Field>
      <Field label="شماره تماس" error={e.phone?.message} hint="تلفن یا ایمیل کافی است">
        <Input dir="ltr" type="tel" autoComplete="tel" inputMode="tel" {...form.register('phone')} />
      </Field>
      <Field label="ایمیل" error={e.email?.message}>
        <Input dir="ltr" type="email" autoComplete="email" {...form.register('email')} />
      </Field>
      {kind === 'demo' && (
        <Field label="تعداد کارکنان">
          <Select {...form.register('companySize')}>
            <option value="">انتخاب کنید</option>
            <option value="1-10">۱ تا ۱۰</option>
            <option value="11-50">۱۱ تا ۵۰</option>
            <option value="51-200">۵۱ تا ۲۰۰</option>
            <option value="201-500">۲۰۱ تا ۵۰۰</option>
            <option value="500+">بیش از ۵۰۰</option>
          </Select>
        </Field>
      )}
      <Field label={kind === 'demo' ? 'نیازها و ماژول‌های مورد نظر' : 'پیام'} error={e.message?.message} className="sm:col-span-2">
        <Textarea rows={4} {...form.register('message')} />
      </Field>
      {/* Honeypot: invisible to people and assistive technology, filled only by bots. */}
      <div aria-hidden="true" className="absolute -start-[9999px] size-px overflow-hidden">
        <label>
          وب‌سایت
          <input tabIndex={-1} autoComplete="off" {...form.register('website')} />
        </label>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" loading={form.formState.isSubmitting} disabled={!token}>
          {kind === 'demo' ? 'ثبت درخواست دمو' : 'ارسال پیام'}
        </Button>
      </div>
    </form>
  );
}
