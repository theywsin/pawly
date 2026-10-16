import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Field, Input } from '@mohandesyar/ui';
import { appApi, setToken } from '../../lib/api.js';
import { applyServerErrors } from '../../lib/errors.js';
import { AuthLayout } from './AuthLayout.js';
import { usePlans } from '../public/data.js';

// Mirrors the server policy (apps/api/src/core/auth/crypto.ts); the server remains authoritative.
const schema = z
  .object({
    fullName: z.string().trim().min(2, 'نام و نام خانوادگی را وارد کنید'),
    email: z.email('ایمیل معتبر وارد کنید'),
    tenantName: z.string().trim().min(2, 'نام سازمان را وارد کنید'),
    password: z.string().min(10, 'رمز عبور باید دست‌کم ۱۰ نویسه باشد').regex(/\p{L}/u, 'رمز عبور باید حرف داشته باشد').regex(/\p{Nd}/u, 'رمز عبور باید عدد داشته باشد'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'تکرار رمز عبور یکسان نیست' });
type Form = z.infer<typeof schema>;

export function Signup() {
  const nav = useNavigate();
  // Arriving from "buy this plan": the plan is kept and checkout follows the signup.
  const [sp] = useSearchParams();
  const planKey = sp.get('plan') ?? undefined;
  const cycle = sp.get('cycle') === 'yearly' ? 'yearly' : 'monthly';
  const plans = usePlans();
  const plan = planKey ? plans.data?.find((p) => p.key === planKey) : undefined;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const form = useForm<Form>({ resolver: zodResolver(schema) });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async ({ confirm: _c, ...values }) => {
    setError(null);
    try {
      const r = await appApi<{ accessToken?: string; pendingApproval?: boolean }>('/api/auth/signup', { method: 'POST', body: { ...values, planKey } });
      if (r.pendingApproval) return setPending(true);
      setToken('app', r.accessToken!);
      nav(planKey ? `/app/billing/checkout?plan=${encodeURIComponent(planKey)}&cycle=${cycle}` : '/app', { replace: true });
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });
  if (pending) {
    return (
      <AuthLayout title="درخواست ثبت شد">
        <Alert tone="success">فضای کاری شما ساخته شد و پس از تأیید مدیر سامانه فعال می‌شود. پس از تأیید با همین ایمیل و رمز وارد شوید.</Alert>
        <Link className="mt-4 inline-block text-primary underline" to="/">
          بازگشت به صفحه اصلی
        </Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title="ثبت‌نام سازمان"
      subtitle="یک فضای کاری برای شرکت خود بسازید. شما مدیر این فضا خواهید بود."
      footer={
        <>
          قبلاً ثبت‌نام کرده‌اید؟{' '}
          <Link className="text-primary underline" to="/auth/login">
            ورود
          </Link>
        </>
      }
    >
      {plan && (
        <Alert tone="info" className="mb-4">
          پلن انتخاب‌شده: <strong>{plan.name}</strong>. پس از ساخت حساب، صفحه پرداخت باز می‌شود.
        </Alert>
      )}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="نام و نام خانوادگی" error={e.fullName?.message} required>
          <Input autoComplete="name" {...form.register('fullName')} />
        </Field>
        <Field label="نام سازمان یا شرکت" error={e.tenantName?.message} required>
          <Input autoComplete="organization" {...form.register('tenantName')} />
        </Field>
        <Field label="ایمیل" error={e.email?.message} required>
          <Input dir="ltr" type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="رمز عبور" error={e.password?.message} hint="دست‌کم ۱۰ نویسه، شامل حرف و عدد" required>
          <Input dir="ltr" type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field label="تکرار رمز عبور" error={e.confirm?.message} required>
          <Input dir="ltr" type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          ساخت فضای کاری
        </Button>
      </form>
    </AuthLayout>
  );
}
