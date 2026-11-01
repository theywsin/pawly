import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DateText, Field, Input, Ltr, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { appApi, setToken } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { useAppSession } from '../../lib/session.js';
import { useUi } from '../../lib/ui-store.js';

export function TotpEnrollment({ start, confirm, onDone }: { start: () => Promise<{ secret: string; otpauthUrl: string }>; confirm: (code: string) => Promise<unknown>; onDone: () => void }) {
  const [data, setData] = useState<{ secret: string; otpauthUrl: string; svg: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const begin = async () => {
    setError(null);
    try {
      const d = await start();
      setData({ ...d, svg: await QRCode.toString(d.otpauthUrl, { type: 'svg', margin: 1, width: 192 }) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  if (!data) {
    return (
      <>
        {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
        <Button onClick={() => void begin()}>فعال‌سازی تأیید دومرحله‌ای</Button>
      </>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm leading-7">این کد QR را با برنامه احراز هویت (مانند Google Authenticator، Aegis یا FreeOTP) اسکن کنید، یا کلید را دستی وارد کنید:</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded bg-white p-2" aria-label="کد QR تأیید دومرحله‌ای" role="img" dangerouslySetInnerHTML={{ __html: data.svg }} />
        <Ltr className="break-all rounded bg-surface-2 px-2 py-1 font-mono text-sm" >{data.secret}</Ltr>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await confirm(code);
            onDone();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="کد ۶ رقمی" className="w-40">
          <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Button type="submit" loading={busy} disabled={code.length !== 6}>
          تأیید
        </Button>
      </form>
    </div>
  );
}

interface Session {
  id: string;
  ip: string | null;
  user_agent: string | null;
  last_used_at: string;
}

export function Profile() {
  const { me } = useAppSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { theme, setTheme } = useUi();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => appApi<Session[]>('/api/auth/sessions') });
  const [confirmAll, setConfirmAll] = useState(false);
  const logoutAll = useMutation({
    mutationFn: () => appApi('/api/auth/logout-all', { method: 'POST' }),
    onSuccess: () => {
      setToken('app', null);
      qc.clear();
      nav('/auth/login', { replace: true });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const [pw, setPw] = useState({ current: '', next: '' });
  const changePw = useMutation({
    mutationFn: () => appApi('/api/auth/password', { method: 'POST', body: pw }),
    onSuccess: () => {
      toast('رمز عبور تغییر کرد؛ دوباره وارد شوید');
      setToken('app', null);
      qc.clear();
      nav('/auth/login', { replace: true });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <>
      <PageHeader title="حساب کاربری" description={me.user.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="تأیید دومرحله‌ای" description="ورود با رمز عبور به‌علاوه کد یک‌بارمصرف" actions={me.user.totpEnabled ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>} />
          <div className="p-5">
            {me.user.totpEnabled ? (
              <p className="text-sm text-muted">تأیید دومرحله‌ای برای حساب شما فعال است.</p>
            ) : (
              <TotpEnrollment
                start={() => appApi('/api/auth/2fa/enroll/start', { method: 'POST' })}
                confirm={(code) => appApi('/api/auth/2fa/enroll/confirm', { method: 'POST', body: { code } })}
                onDone={() => {
                  toast('تأیید دومرحله‌ای فعال شد');
                  void qc.invalidateQueries({ queryKey: ['me'] });
                }}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="تغییر رمز عبور" description="پس از تغییر، از همه دستگاه‌ها خارج می‌شوید." />
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              changePw.mutate();
            }}
          >
            <Field label="رمز فعلی">
              <Input dir="ltr" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field label="رمز جدید" hint="دست‌کم ۱۰ نویسه، شامل حرف و عدد">
              <Input dir="ltr" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Button type="submit" loading={changePw.isPending} disabled={!pw.current || !pw.next}>
              تغییر رمز
            </Button>
          </form>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="نشست‌های فعال" actions={<Button variant="danger" size="sm" onClick={() => setConfirmAll(true)}>خروج از همه دستگاه‌ها</Button>} />
          <div className="p-5">
            <PageState query={sessions} isEmpty={sessions.data?.length === 0}>
              <Table>
                <thead>
                  <tr>
                    <Th>دستگاه</Th>
                    <Th>نشانی IP</Th>
                    <Th>آخرین استفاده</Th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.data?.map((s) => (
                    <tr key={s.id}>
                      <Td className="max-w-xs truncate">
                        <Ltr>{s.user_agent ?? '—'}</Ltr>
                      </Td>
                      <Td>
                        <Ltr>{s.ip ?? '—'}</Ltr>
                      </Td>
                      <Td>
                        <DateText value={s.last_used_at} relative />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </PageState>
          </div>
        </Card>
        <Card>
          <CardHeader title="اعلان‌ها" description="اعلان‌های درون‌برنامه همیشه نمایش داده می‌شوند." />
          <div className="p-5">
            <Checkbox label="نسخه ایمیلی اعلان‌ها را برایم بفرست (اگر سرور ایمیل سامانه تنظیم شده باشد)" checked={me.user.emailNotifications !== false}
              onChange={(e) => appApi('/api/core/profile/email-notifications', { method: 'PUT', body: { enabled: e.target.checked } }).then(() => (toast('ذخیره شد'), qc.invalidateQueries({ queryKey: ['me'] })))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="ظاهر" />
          <div className="p-5">
            <Field label="حالت نمایش">
              <Select value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}>
                <option value="system">مطابق سیستم</option>
                <option value="light">روشن</option>
                <option value="dark">تیره</option>
              </Select>
            </Field>
          </div>
        </Card>
      </div>
      <ConfirmDialog open={confirmAll} onOpenChange={setConfirmAll} title="خروج از همه دستگاه‌ها" description="همه نشست‌های شما، از جمله همین نشست، باطل می‌شوند." confirmLabel="خروج از همه" loading={logoutAll.isPending} onConfirm={() => logoutAll.mutate()} />
    </>
  );
}
