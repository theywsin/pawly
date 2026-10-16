import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Field, Input } from '@mohandesyar/ui';
import { appApi, setToken } from '../../lib/api.js';
import { applyServerErrors, errorMessage } from '../../lib/errors.js';
import { AuthLayout } from './AuthLayout.js';

const schema = z.object({ email: z.email('ایمیل معتبر وارد کنید'), password: z.string().min(1, 'رمز عبور را وارد کنید') });
type Form = z.infer<typeof schema>;

interface LoginResponse {
  accessToken?: string;
  mfaRequired?: boolean;
  pendingToken?: string;
  tenants?: { id: string; name: string }[];
}

export function Login() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/app') ? params.get('next')! : '/app';
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Form | null>(null);
  const [tenants, setTenants] = useState<{ id: string; name: string }[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<Form>({ resolver: zodResolver(schema) });

  const finish = (r: LoginResponse) => {
    if (r.accessToken) {
      setToken('app', r.accessToken);
      nav(next, { replace: true });
    } else if (r.mfaRequired && r.pendingToken) setPending(r.pendingToken);
    else if (r.tenants) setTenants(r.tenants);
  };

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      setCreds(values);
      finish(await appApi<LoginResponse>('/api/auth/login', { method: 'POST', body: values }));
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });

  const pickTenant = async (tenantId: string) => {
    setBusy(true);
    setError(null);
    try {
      finish(await appApi<LoginResponse>('/api/auth/login', { method: 'POST', body: { ...creds, tenantId } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      finish(await appApi<LoginResponse>('/api/auth/2fa', { method: 'POST', body: { pendingToken: pending, code: otp } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <AuthLayout title="تأیید دومرحله‌ای" subtitle="کد ۶ رقمی برنامه احراز هویت را وارد کنید.">
        {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          className="space-y-4"
        >
          <Field label="کد تأیید">
            <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={otp.length !== 6}>
            تأیید و ورود
          </Button>
        </form>
      </AuthLayout>
    );
  }

  if (tenants) {
    return (
      <AuthLayout title="انتخاب سازمان" subtitle="حساب شما عضو چند سازمان است.">
        {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
        <ul className="space-y-2">
          {tenants.map((t) => (
            <li key={t.id}>
              <Button variant="secondary" className="w-full justify-start" disabled={busy} onClick={() => void pickTenant(t.id)}>
                {t.name}
              </Button>
            </li>
          ))}
        </ul>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="ورود"
      subtitle="به حساب سازمانی خود وارد شوید."
      footer={
        <>
          حساب ندارید؟{' '}
          <Link className="text-primary underline" to="/auth/signup">
            ثبت‌نام سازمان
          </Link>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="ایمیل" error={form.formState.errors.email?.message} required>
          <Input dir="ltr" type="email" autoComplete="username" {...form.register('email')} />
        </Field>
        <Field label="رمز عبور" error={form.formState.errors.password?.message} required>
          <Input dir="ltr" type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          ورود
        </Button>
      </form>
    </AuthLayout>
  );
}
