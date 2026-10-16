import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, Field, Input, PageState, toast } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { ImageUpload } from './ImageUpload.js';

interface Client {
  id: string;
  name: string;
  url: string | null;
  logo_id: string;
  logo: string;
  sort: number;
  published: boolean;
}

function ClientEditor({ item, onDone }: { item: Client | null; onDone(): void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(item?.name ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [logo, setLogo] = useState<{ id: string; url: string } | null>(item ? { id: item.logo_id, url: item.logo } : null);
  const [sort, setSort] = useState(String(item?.sort ?? 0));
  const [published, setPublished] = useState(item?.published ?? true);
  const save = useMutation({
    mutationFn: () => consoleApi(`/api/console/site/clients/${item?.id ?? 'new'}`, { method: 'PUT', body: { name, url: url.trim() || null, logoId: logo?.id, sort: Number(sort) || 0, published } }),
    onSuccess: () => {
      toast('مشتری ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['site-clients'] });
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نام مشتری">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="وب‌سایت (اختیاری)">
          <Input dir="ltr" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
      </div>
      <Field label="لوگو">
        <ImageUpload value={logo?.url ?? null} onChange={setLogo} label="بارگذاری لوگو" />
      </Field>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="ترتیب" className="w-24">
          <Input dir="ltr" value={sort} onChange={(e) => setSort(e.target.value)} />
        </Field>
        <Checkbox label="نمایش در سایت" checked={published} onChange={(e) => setPublished(e.target.checked)} />
        <Button size="sm" loading={save.isPending} disabled={!logo} onClick={() => save.mutate()}>
          ذخیره
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          انصراف
        </Button>
      </div>
    </div>
  );
}

/** "Our customers" logos on the home page. */
export function ClientsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['site-clients'], queryFn: () => consoleApi<Client[]>('/api/console/site/clients') });
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => consoleApi(`/api/console/site/clients/${id}/delete`, { method: 'POST' }),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['site-clients'] });
    },
  });
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="مشتریان ما" description="لوگوها در صفحه اصلی نمایش داده می‌شوند؛ تا وقتی لوگویی منتشر نشده، این بخش در سایت پنهان است." actions={<Button size="sm" onClick={() => setEditing('new')}>افزودن مشتری</Button>} />
      <div className="space-y-3 p-5">
        {editing === 'new' && <ClientEditor item={null} onDone={() => setEditing(null)} />}
        <PageState query={q}>
          {q.data?.length === 0 && editing !== 'new' && <p className="text-sm text-muted">هنوز مشتری‌ای ثبت نشده است.</p>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {q.data?.map((c) =>
              editing !== 'new' && editing?.id === c.id ? (
                <li key={c.id} className="sm:col-span-2">
                  <ClientEditor item={c} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <img src={c.logo} alt="" className="h-12 w-20 rounded bg-white object-contain p-1" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    {!c.published && <Badge>پنهان</Badge>}
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>ویرایش</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(c)}>حذف</Button>
                </li>
              ),
            )}
          </ul>
        </PageState>
      </div>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="حذف مشتری" description={deleting?.name} confirmLabel="حذف" loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} />
    </Card>
  );
}

const PLATFORMS = [
  { key: 'android', label: 'اندروید' },
  { key: 'ios', label: 'iOS (آیفون و آیپد)' },
  { key: 'windows', label: 'ویندوز' },
  { key: 'mac', label: 'مک' },
] as const;
type Apps = Record<(typeof PLATFORMS)[number]['key'], { url: string; version: string; note: string }>;

/** Install links for the /download page. */
export function AppsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['site-apps'], queryFn: () => consoleApi<Apps>('/api/console/site/apps') });
  const [v, setV] = useState<Apps | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => consoleApi('/api/console/site/apps', { method: 'PUT', body: v }),
    onSuccess: () => {
      toast('پیوندهای دانلود ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['site-apps'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="دانلود اپلیکیشن" description="پیوند نصب هر سیستم‌عامل (مثلاً فروشگاه اپلیکیشن یا فایل نصب). سیستم‌عاملی که پیوند ندارد در صفحه دانلود «به‌زودی» نمایش داده می‌شود." />
      <PageState query={q}>
        {v && (
          <div className="space-y-4 p-5">
            {PLATFORMS.map((p) => (
              <fieldset key={p.key} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[8rem_1fr_7rem]">
                <legend className="px-1 text-sm font-semibold">{p.label}</legend>
                <Field label="پیوند نصب" className="sm:col-span-2">
                  <Input dir="ltr" placeholder="https://" value={v[p.key].url} onChange={(e) => setV({ ...v, [p.key]: { ...v[p.key], url: e.target.value } })} />
                </Field>
                <Field label="نسخه">
                  <Input dir="ltr" value={v[p.key].version} onChange={(e) => setV({ ...v, [p.key]: { ...v[p.key], version: e.target.value } })} />
                </Field>
                <Field label="توضیح کوتاه (اختیاری)" className="sm:col-span-3">
                  <Input value={v[p.key].note} onChange={(e) => setV({ ...v, [p.key]: { ...v[p.key], note: e.target.value } })} />
                </Field>
              </fieldset>
            ))}
            <Button loading={save.isPending} onClick={() => save.mutate()}>ذخیره پیوندها</Button>
          </div>
        )}
      </PageState>
    </Card>
  );
}
