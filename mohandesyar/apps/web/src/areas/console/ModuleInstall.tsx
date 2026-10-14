import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, UploadCloud, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Input, Ltr, PageHeader, Spinner } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';

interface Preview {
  uploadId: string;
  ok: boolean;
  checks: { key: string; ok: boolean; message: string }[];
  manifest: {
    id: string;
    version: string;
    name: { fa: string };
    description: { fa: string };
    publisher: { name: string };
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
    permissions: { key: string; fa: string }[];
    events: { publishes: { type: string }[]; consumes: { type: string }[] };
  } | null;
  signerKeyId: string | null;
  packageSha256: string | null;
  kind: 'install' | 'upgrade' | 'reinstall' | 'downgrade' | null;
  currentVersion: string | null;
  migrations: { file: string; kind: string; pending: boolean }[];
  tables: string[];
}

interface Operation {
  status: string;
  error: string | null;
  log: { at: string; line: string }[];
}

const STEPS = ['بارگذاری بسته', 'بررسی امضا و سازگاری', 'تأیید', 'نصب', 'نتیجه'];
const KIND: Record<string, string> = { install: 'نصب جدید', upgrade: 'ارتقا', reinstall: 'نصب دوباره', downgrade: 'نسخه قدیمی‌تر' };

/** Step-by-step installation (docs/07 §6): upload → verify → review → confirm with fresh 2FA → progress & log → result. */
export function ModuleInstall() {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [otp, setOtp] = useState('');
  const [enableGlobally, setEnableGlobally] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string; op?: Operation } | null>(null);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const p = await consoleApi<Preview>('/api/console/modules/upload', { method: 'POST', raw: fd });
      setPreview(p);
      setStep(1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!preview) return;
    setStep(3);
    setBusy(true);
    setError(null);
    try {
      const r = await consoleApi<{ operationId: string; moduleId: string; version: string }>('/api/console/modules/install', { method: 'POST', body: { uploadId: preview.uploadId, otp, enableGlobally } });
      const op = await consoleApi<Operation>(`/api/console/modules/operations/${r.operationId}`);
      setResult({ ok: true, message: `ماژول ${r.moduleId} نسخه ${r.version} نصب شد. سرویس‌ها برای بارگذاری کد جدید به‌صورت کنترل‌شده راه‌اندازی مجدد می‌شوند.`, op });
      void qc.invalidateQueries({ queryKey: ['console-modules'] });
    } catch (e) {
      const details = (e as { details?: { operationId?: string } }).details;
      const op = details?.operationId ? await consoleApi<Operation>(`/api/console/modules/operations/${details.operationId}`).catch(() => undefined) : undefined;
      if ((e as { code?: string }).code === 'INVALID_OTP') {
        setError(errorMessage(e));
        setStep(2);
        return;
      }
      setResult({ ok: false, message: errorMessage(e), op });
    } finally {
      setBusy(false);
    }
    setStep(4);
  };

  const m = preview?.manifest;
  return (
    <>
      <PageHeader title="نصب ماژول جدید" />
      <ol className="mb-6 flex flex-wrap gap-2 text-sm" aria-label="مراحل نصب">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={`rounded-full px-3 py-1 ${i === step ? 'bg-primary text-primary-fg' : i < step ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-muted'}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      {step === 0 && (
        <Card className="p-6">
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border p-10 text-center hover:bg-surface-2">
            <UploadCloud className="size-10 text-muted" />
            <span>فایل بسته ماژول (‎.mypkg) را انتخاب کنید</span>
            <span className="text-sm text-muted">حداکثر ۵۰ مگابایت؛ بسته باید با کلید مورد اعتماد پلتفرم امضا شده باشد.</span>
            <input type="file" accept=".mypkg" className="sr-only" data-testid="package-input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <Ltr className="font-mono text-sm">{file.name}</Ltr>}
          </label>
          <div className="mt-4 flex justify-end">
            <Button disabled={!file} loading={busy} onClick={() => void upload()}>
              بارگذاری و بررسی
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && preview && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="نتیجه بررسی‌ها" description={preview.ok ? 'بسته معتبر و قابل نصب است.' : 'بسته رد شد؛ هیچ کدی از آن اجرا نشده است.'} actions={preview.ok ? <Badge tone="success">معتبر</Badge> : <Badge tone="danger">رد شد</Badge>} />
            <ul className="space-y-2 p-5" data-testid="checks">
              {preview.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  {c.ok ? <CheckCircle2 className="mt-1 size-4 shrink-0 text-success" aria-label="موفق" /> : <XCircle className="mt-1 size-4 shrink-0 text-danger" aria-label="ناموفق" />}
                  {c.message}
                </li>
              ))}
            </ul>
          </Card>
          {m && (
            <Card>
              <CardHeader title={`${m.name.fa} — نسخه ${m.version}`} description={m.description.fa} actions={preview.kind && <Badge tone="info">{KIND[preview.kind]}{preview.currentVersion ? ` از ${preview.currentVersion}` : ''}</Badge>} />
              <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium">ناشر و امضا</dt>
                  <dd className="text-muted">
                    {m.publisher.name} — کلید <Ltr className="font-mono">{preview.signerKeyId}</Ltr>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">وابستگی‌ها</dt>
                  <dd className="text-muted">
                    <Ltr>{Object.entries(m.dependencies).map(([k, v]) => `${k}@${v}`).join(', ') || 'ندارد'}</Ltr>
                    {Object.keys(m.optionalDependencies).length > 0 && (
                      <>
                        {' '}
                        (اختیاری: <Ltr>{Object.keys(m.optionalDependencies).join(', ')}</Ltr>)
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">مجوزهای تعریف‌شده</dt>
                  <dd className="text-muted">{m.permissions.map((p) => p.fa).join('، ') || 'ندارد'}</dd>
                </div>
                <div>
                  <dt className="font-medium">جداول</dt>
                  <dd>
                    <Ltr className="font-mono text-xs text-muted">{preview.tables.join(', ') || '—'}</Ltr>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-medium">مهاجرت‌های پایگاه داده</dt>
                  <dd className="mt-1 flex flex-wrap gap-2">
                    {preview.migrations.map((x) => (
                      <Badge key={x.file} tone={x.pending ? 'info' : 'neutral'}>
                        <Ltr>{x.file}</Ltr> · {x.kind === 'contract' ? 'تخریبی' : 'افزایشی'} · {x.pending ? 'اجرا می‌شود' : 'قبلاً اجرا شده'}
                      </Badge>
                    ))}
                  </dd>
                </div>
              </dl>
            </Card>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setStep(0); setPreview(null); }}>
              بسته دیگر
            </Button>
            {preview.ok && <Button onClick={() => setStep(2)}>ادامه</Button>}
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <Card className="max-w-lg space-y-4 p-6">
          <Alert tone="warning" title="نصب ماژول یعنی اجرای کد روی سرور">
            همه مهاجرت‌ها در یک تراکنش اجرا می‌شوند و در صورت هر خطا، همه تغییرات برگردانده می‌شود. این عملیات در گزارش رویدادها ثبت می‌شود.
          </Alert>
          <Checkbox label="پس از نصب، ماژول در سطح پلتفرم فعال شود" checked={enableGlobally} onChange={(e) => setEnableGlobally(e.target.checked)} />
          <Field label="کد تأیید دومرحله‌ای" hint="برای هر نصب یک کد تازه لازم است.">
            <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              بازگشت
            </Button>
            <Button disabled={otp.length !== 6} onClick={() => void install()}>
              نصب
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && busy && (
        <Card className="flex items-center gap-3 p-6" aria-live="polite">
          <Spinner className="size-6 text-primary" /> در حال نصب: بارگذاری آزمایشی کد، اجرای مهاجرت‌ها و ثبت در رجیستری…
        </Card>
      )}

      {step === 4 && result && (
        <div className="space-y-4">
          <Alert tone={result.ok ? 'success' : 'danger'} title={result.ok ? 'نصب انجام شد' : 'نصب انجام نشد'}>
            {result.message}
          </Alert>
          {result.op && (
            <Card>
              <CardHeader title="گزارش عملیات" />
              <ol className="space-y-1 p-5 font-mono text-xs" data-testid="operation-log">
                {result.op.log.map((l, i) => (
                  <li key={i}>{l.line}</li>
                ))}
              </ol>
            </Card>
          )}
          <div className="flex gap-2">
            <Link to="/console/modules">
              <Button variant="secondary">بازگشت به فهرست</Button>
            </Link>
            {result.ok && preview?.manifest && (
              <Link to={`/console/modules/${preview.manifest.id}`}>
                <Button>مدیریت ماژول</Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
