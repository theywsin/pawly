import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Field, Input } from '@mohandesyar/ui';
import { consoleApi, setToken } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { AuthLayout } from '../auth/AuthLayout.js';
import { TotpEnrollment } from '../app/Profile.js';

interface R {
  accessToken?: string;
  mfaRequired?: boolean;
  mfaEnrollmentRequired?: boolean;
  pendingToken?: string;
}

/** Platform console sign-in. Two-factor authentication is mandatory for every platform admin. */
export function ConsoleLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<{ kind: 'password' } | { kind: 'otp' | 'enrol'; pending: string }>({ kind: 'password' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = (r: R) => {
    if (r.accessToken) {
      setToken('console', r.accessToken);
      nav('/console', { replace: true });
    } else if (r.mfaEnrollmentRequired && r.pendingToken) setStep({ kind: 'enrol', pending: r.pendingToken });
    else if (r.mfaRequired && r.pendingToken) setStep({ kind: 'otp', pending: r.pendingToken });
  };
  const run = async (fn: () => Promise<R>) => {
    setBusy(true);
    setError(null);
    try {
      done(await fn());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (step.kind === 'enrol') {
    return (
      <AuthLayout title="فعال‌سازی تأیید دومرحله‌ای" subtitle="ورود به پنل مدیریت پلتفرم بدون تأیید دومرحله‌ای ممکن نیست.">
        <TotpEnrollment
          start={() => consoleApi('/api/console/auth/2fa/enroll/start', { method: 'POST', body: { pendingToken: step.pending } })}
          confirm={async (c) => done(await consoleApi<R>('/api/console/auth/2fa/enroll/confirm', { method: 'POST', body: { pendingToken: step.pending, code: c } }))}
          onDone={() => undefined}
        />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="پنل مدیریت پلتفرم" subtitle={step.kind === 'otp' ? 'کد ۶ رقمی برنامه احراز هویت را وارد کنید.' : 'ورود مدیران پلتفرم'}>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {step.kind === 'password' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => consoleApi<R>('/api/console/auth/login', { method: 'POST', body: { email, password } }));
          }}
        >
          <Field label="ایمیل">
            <Input dir="ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="رمز عبور">
            <Input dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            ادامه
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => consoleApi<R>('/api/console/auth/2fa', { method: 'POST', body: { pendingToken: step.pending, code } }));
          }}
        >
          <Field label="کد تأیید">
            <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
            ورود
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
