import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, Field, Input, PageHeader, PageState, Select, Textarea, toast } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';

interface Faq {
  id: string;
  question: string;
  answer: string;
  sort: number;
  published: boolean;
}
interface ContentData {
  content: { key: string; value: Record<string, string> }[];
  faq: Faq[];
}

function FaqEditor({ item, onDone }: { item: Faq | null; onDone(): void }) {
  const qc = useQueryClient();
  const [question, setQ] = useState(item?.question ?? '');
  const [answer, setA] = useState(item?.answer ?? '');
  const [sort, setSort] = useState(String(item?.sort ?? 0));
  const [published, setPublished] = useState(item?.published ?? true);
  const save = useMutation({
    mutationFn: () => consoleApi(`/api/console/faq/${item?.id ?? 'new'}`, { method: 'PUT', body: { question, answer, sort: Number(sort) || 0, published } }),
    onSuccess: () => {
      toast('پرسش ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['content'] });
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <Field label="پرسش">
        <Input value={question} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <Field label="پاسخ">
        <Textarea rows={3} value={answer} onChange={(e) => setA(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="ترتیب" className="w-24">
          <Input dir="ltr" value={sort} onChange={(e) => setSort(e.target.value)} />
        </Field>
        <Checkbox label="منتشر شود" checked={published} onChange={(e) => setPublished(e.target.checked)} />
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>انصراف</Button>
      </div>
    </div>
  );
}

const PAGES = [
  { key: 'about', label: 'درباره ما' },
  { key: 'terms', label: 'شرایط استفاده' },
  { key: 'privacy', label: 'حریم خصوصی' },
] as const;

function PageEditor({ data }: { data: ContentData }) {
  const qc = useQueryClient();
  const [key, setKey] = useState<(typeof PAGES)[number]['key']>('about');
  const current = data.content.find((c) => c.key === key)?.value;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    setTitle(current?.title ?? PAGES.find((p) => p.key === key)!.label);
    setBody(current?.body ?? '');
  }, [key, current?.title, current?.body]);
  const save = useMutation({
    mutationFn: () => consoleApi(`/api/console/content/${key}`, { method: 'PUT', body: { title, body } }),
    onSuccess: () => {
      toast('صفحه منتشر شد');
      void qc.invalidateQueries({ queryKey: ['content'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const remove = useMutation({
    mutationFn: () => consoleApi(`/api/console/content/${key}/delete`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['content'] }),
  });
  return (
    <Card>
      <CardHeader title="صفحات" description="متن ساده؛ پاراگراف‌ها را با یک خط خالی جدا کنید." />
      <div className="space-y-3 p-5">
        <Field label="صفحه">
          <Select value={key} onChange={(e) => setKey(e.target.value as typeof key)}>
            {PAGES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} {data.content.some((c) => c.key === p.key) ? '(منتشرشده)' : '(منتشرنشده)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="عنوان">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="متن">
          <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button loading={save.isPending} onClick={() => save.mutate()}>انتشار</Button>
          {current && <Button variant="ghost" onClick={() => remove.mutate()}>حذف از سایت</Button>}
        </div>
      </div>
    </Card>
  );
}

function ContactEditor({ data }: { data: ContentData }) {
  const qc = useQueryClient();
  const c = data.content.find((x) => x.key === 'contact')?.value ?? {};
  const [v, setV] = useState({ phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', hours: c.hours ?? '' });
  const save = useMutation({
    mutationFn: () => consoleApi('/api/console/content/contact', { method: 'PUT', body: Object.fromEntries(Object.entries(v).filter(([, x]) => x)) }),
    onSuccess: () => {
      toast('اطلاعات تماس ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['content'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Card>
      <CardHeader title="اطلاعات تماس" description="در پانویس و صفحه تماس نمایش داده می‌شود؛ خالی‌ها نمایش داده نمی‌شوند." />
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <Field label="تلفن"><Input dir="ltr" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="ایمیل"><Input dir="ltr" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="نشانی" className="sm:col-span-2"><Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        <Field label="ساعات پاسخ‌گویی" className="sm:col-span-2"><Input value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} /></Field>
        <div><Button loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button></div>
      </div>
    </Card>
  );
}

/** Landing content managed by the platform (prompt §4: plans, FAQ, contact info). */
export function Content() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['content'], queryFn: () => consoleApi<ContentData>('/api/console/content') });
  const [editing, setEditing] = useState<Faq | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Faq | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => consoleApi(`/api/console/faq/${id}/delete`, { method: 'POST' }),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['content'] });
    },
  });
  return (
    <>
      <PageHeader title="محتوای سایت" description="پرسش‌های متداول، اطلاعات تماس و صفحات حقوقی. بخش‌های خالی در سایت نمایش داده نمی‌شوند." />
      <PageState query={q}>
        {q.data && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="lg:col-span-2">
              <CardHeader title="پرسش‌های متداول" actions={<Button size="sm" onClick={() => setEditing('new')}>پرسش جدید</Button>} />
              <div className="space-y-3 p-5">
                {editing === 'new' && <FaqEditor item={null} onDone={() => setEditing(null)} />}
                {q.data.faq.length === 0 && editing !== 'new' && <p className="text-sm text-muted">هنوز پرسشی ثبت نشده است.</p>}
                {q.data.faq.map((f) =>
                  editing !== 'new' && editing?.id === f.id ? (
                    <FaqEditor key={f.id} item={f} onDone={() => setEditing(null)} />
                  ) : (
                    <div key={f.id} className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
                      <div>
                        <p className="font-medium">{f.question} {!f.published && <Badge>منتشرنشده</Badge>}</p>
                        <p className="mt-1 whitespace-pre-line text-sm text-muted">{f.answer}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>ویرایش</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(f)}>حذف</Button>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </Card>
            <ContactEditor data={q.data} />
            <PageEditor data={q.data} />
          </div>
        )}
      </PageState>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="حذف پرسش" description={deleting?.question} confirmLabel="حذف" loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} />
    </>
  );
}
