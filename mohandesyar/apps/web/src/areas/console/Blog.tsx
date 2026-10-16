import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Heading2, Heading3, Image, List, ListOrdered, Pilcrow, Quote, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ConfirmDialog, DateInput, DateText, EmptyState, Field, Input, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { utcToZoned, zonedToUtc } from '@mohandesyar/persian';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { ImageUpload, uploadImage } from './ImageUpload.js';

interface PostRow {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  scheduled: boolean;
  published_at: string | null;
  updated_at: string;
  category_name: string | null;
}
interface Category {
  id: string;
  slug: string;
  name: string;
  sort: number;
  posts: number;
}
type Block =
  | { type: 'p' | 'h2' | 'h3' | 'quote'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'img'; mediaId: string; src?: string; caption: string; alt: string };

/** Persian/Latin slug from a title: words joined with hyphens, punctuation dropped. */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[‌\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

export function BlogPosts() {
  const q = useQuery({ queryKey: ['blog-posts'], queryFn: () => consoleApi<PostRow[]>('/api/console/site/blog/posts') });
  return (
    <>
      <PageHeader
        title="وبلاگ"
        description="مطالب وبلاگ سایت. مطلب منتشرشده با زمان آینده، در همان زمان خودکار منتشر می‌شود."
        actions={
          <div className="flex gap-2">
            <Link to="/console/blog/categories" className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-2">
              دسته‌بندی‌ها
            </Link>
            <Link to="/console/blog/new" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg">
              مطلب جدید
            </Link>
          </div>
        }
      />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title="هنوز مطلبی نوشته نشده است" description="اولین مطلب را بنویسید؛ تا وقتی مطلبی منتشر نشده، وبلاگ سایت حالت خالی نشان می‌دهد." />}>
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>عنوان</Th>
                <Th>دسته</Th>
                <Th>وضعیت</Th>
                <Th>آخرین تغییر</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link to={`/console/blog/${p.id}`} className="font-medium text-primary hover:underline">
                      {p.title}
                    </Link>
                  </Td>
                  <Td>{p.category_name ?? '—'}</Td>
                  <Td>
                    {p.status === 'draft' ? <Badge>پیش‌نویس</Badge> : p.scheduled ? <Badge tone="warning">زمان‌بندی‌شده</Badge> : <Badge tone="success">منتشرشده</Badge>}
                  </Td>
                  <Td>
                    <DateText value={p.updated_at} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </PageState>
    </>
  );
}

const BLOCK_TYPES = [
  { type: 'p', label: 'پاراگراف', icon: Pilcrow },
  { type: 'h2', label: 'تیتر', icon: Heading2 },
  { type: 'h3', label: 'زیرتیتر', icon: Heading3 },
  { type: 'ul', label: 'فهرست', icon: List },
  { type: 'ol', label: 'فهرست شماره‌دار', icon: ListOrdered },
  { type: 'quote', label: 'نقل‌قول', icon: Quote },
] as const;

function BlockEditor({ block, onChange }: { block: Block; onChange(b: Block): void }) {
  if (block.type === 'img') {
    return (
      <div className="space-y-2">
        {block.src && <img src={block.src} alt="" className="max-h-60 rounded border border-border" />}
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="زیرنویس تصویر">
            <Input value={block.caption} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
          </Field>
          <Field label="متن جایگزین (برای نابینایان و موتور جست‌وجو)">
            <Input value={block.alt} onChange={(e) => onChange({ ...block, alt: e.target.value })} />
          </Field>
        </div>
      </div>
    );
  }
  if ('items' in block) {
    return (
      <Field label="موارد فهرست (هر مورد در یک خط)">
        <Textarea rows={4} value={block.items.join('\n')} onChange={(e) => onChange({ ...block, items: e.target.value.split('\n') })} />
      </Field>
    );
  }
  const label = BLOCK_TYPES.find((t) => t.type === block.type)!.label;
  return block.type === 'h2' || block.type === 'h3' ? (
    <Field label={label}>
      <Input value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} className={block.type === 'h2' ? 'text-lg font-bold' : 'font-semibold'} />
    </Field>
  ) : (
    <Field label={label}>
      <Textarea rows={block.type === 'p' ? 5 : 3} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
    </Field>
  );
}

interface Draft {
  slug: string;
  title: string;
  excerpt: string;
  cover: { id: string; url: string } | null;
  categoryId: string;
  tags: string;
  body: Block[];
  status: 'draft' | 'published';
  date: string | null;
  time: string;
  authorName: string;
  seoTitle: string;
  seoDescription: string;
}

const emptyDraft = (): Draft => ({ slug: '', title: '', excerpt: '', cover: null, categoryId: '', tags: '', body: [{ type: 'p', text: '' }], status: 'draft', date: null, time: '09:00', authorName: '', seoTitle: '', seoDescription: '' });

export function BlogEditor() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['blog-categories'], queryFn: () => consoleApi<Category[]>('/api/console/site/blog/categories') });
  const post = useQuery({
    queryKey: ['blog-post', id],
    enabled: !isNew,
    queryFn: () =>
      consoleApi<{ slug: string; title: string; excerpt: string; cover_id: string | null; cover: string | null; category_id: string | null; tags: string[]; body: Block[]; status: 'draft' | 'published'; published_at: string | null; author_name: string; seo_title: string; seo_description: string }>(
        `/api/console/site/blog/posts/${id}`,
      ),
  });
  const [d, setD] = useState<Draft>(emptyDraft);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    const p = post.data;
    if (!p) return;
    const z = p.published_at ? utcToZoned(p.published_at) : null;
    setD({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      cover: p.cover_id && p.cover ? { id: p.cover_id, url: p.cover } : null,
      categoryId: p.category_id ?? '',
      tags: p.tags.join('، '),
      body: p.body,
      status: p.status,
      date: z?.date ?? null,
      time: z?.time ?? '09:00',
      authorName: p.author_name,
      seoTitle: p.seo_title,
      seoDescription: p.seo_description,
    });
  }, [post.data]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setBlock = (i: number, b: Block) => set({ body: d.body.map((x, j) => (j === i ? b : x)) });
  const move = (i: number, dir: -1 | 1) => {
    const body = [...d.body];
    const j = i + dir;
    if (j < 0 || j >= body.length) return;
    [body[i], body[j]] = [body[j]!, body[i]!];
    set({ body });
  };

  const save = useMutation({
    mutationFn: (status: 'draft' | 'published') => {
      const body = d.body
        .map((b) => ('items' in b ? { ...b, items: b.items.map((x) => x.trim()).filter(Boolean) } : b))
        .filter((b) => ('items' in b ? b.items.length > 0 : 'text' in b ? b.text.trim() !== '' : true))
        .map((b) => (b.type === 'img' ? { type: 'img', mediaId: b.mediaId, caption: b.caption, alt: b.alt } : b));
      return consoleApi<{ id: string }>(`/api/console/site/blog/posts/${id}`, {
        method: 'PUT',
        body: {
          slug: d.slug,
          title: d.title,
          excerpt: d.excerpt,
          coverId: d.cover?.id ?? null,
          categoryId: d.categoryId || null,
          tags: d.tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean),
          body,
          status,
          publishedAt: status === 'published' ? (d.date ? zonedToUtc(d.date, d.time || '00:00') : null) : null,
          authorName: d.authorName,
          seoTitle: d.seoTitle,
          seoDescription: d.seoDescription,
        },
      });
    },
    onSuccess: (r, status) => {
      toast(status === 'published' ? 'مطلب منتشر شد' : 'پیش‌نویس ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['blog-posts'] });
      void qc.invalidateQueries({ queryKey: ['blog-post', r.id] });
      if (isNew) nav(`/console/blog/${r.id}`, { replace: true });
      if (status === 'published') set({ status });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const del = useMutation({
    mutationFn: () => consoleApi(`/api/console/site/blog/posts/${id}/delete`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['blog-posts'] });
      nav('/console/blog');
    },
  });

  const addImage = async (file: File) => {
    setUploading(true);
    try {
      const img = await uploadImage(file);
      set({ body: [...d.body, { type: 'img', mediaId: img.id, src: img.url, caption: '', alt: '' }] });
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <PageHeader
        title={isNew ? 'مطلب جدید' : 'ویرایش مطلب'}
        actions={
          <div className="flex flex-wrap gap-2">
            {!isNew && d.status === 'published' && (
              <a href={`/blog/${encodeURIComponent(d.slug)}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-surface-2">
                <ExternalLink className="size-4" /> مشاهده در سایت
              </a>
            )}
            <Button variant="secondary" loading={save.isPending && save.variables === 'draft'} onClick={() => save.mutate('draft')}>
              ذخیره پیش‌نویس
            </Button>
            <Button loading={save.isPending && save.variables === 'published'} onClick={() => save.mutate('published')}>
              انتشار
            </Button>
          </div>
        }
      />
      <PageState query={isNew ? { isPending: false, isError: false, error: null, refetch: () => undefined } : post}>
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            <Card>
              <div className="space-y-4 p-5">
                <Field label="عنوان">
                  <Input value={d.title} onChange={(e) => set({ title: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })} className="text-lg font-bold" />
                </Field>
                <Field label="نامک (بخش انتهای نشانی مطلب)" hint={d.slug ? `/blog/${d.slug}` : undefined}>
                  <Input
                    value={d.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set({ slug: e.target.value });
                    }}
                  />
                </Field>
                <Field label="خلاصه (در فهرست مطالب و نتایج جست‌وجو)">
                  <Textarea rows={2} value={d.excerpt} onChange={(e) => set({ excerpt: e.target.value })} />
                </Field>
              </div>
            </Card>
            <Card>
              <CardHeader title="متن مطلب" description="برای متن پررنگ **متن** و برای پیوند [عنوان](https://نشانی) بنویسید." />
              <div className="space-y-4 p-5">
                {d.body.map((b, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <BlockEditor block={b} onChange={(nb) => setBlock(i, nb)} />
                    <div className="mt-2 flex justify-end gap-1">
                      <Button size="sm" variant="ghost" aria-label="انتقال به بالا" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="انتقال به پایین" disabled={i === d.body.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="حذف بخش" onClick={() => set({ body: d.body.filter((_, j) => j !== i) })}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  {BLOCK_TYPES.map(({ type, label, icon: I }) => (
                    <Button key={type} size="sm" variant="secondary" onClick={() => set({ body: [...d.body, type === 'ul' || type === 'ol' ? { type, items: [''] } : { type, text: '' }] })}>
                      <I className="size-4" /> {label}
                    </Button>
                  ))}
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-2">
                    <Image className="size-4" /> {uploading ? 'در حال بارگذاری…' : 'تصویر'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void addImage(f);
                      }}
                    />
                  </label>
                </div>
              </div>
            </Card>
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader title="انتشار" />
              <div className="space-y-3 p-5">
                <p className="text-sm">
                  وضعیت: {d.status === 'published' ? <Badge tone="success">منتشرشده</Badge> : <Badge>پیش‌نویس</Badge>}
                </p>
                <Field label="تاریخ انتشار (خالی = همین حالا)">
                  <DateInput value={d.date} onChange={(v) => set({ date: v })} />
                </Field>
                <Field label="ساعت">
                  <Input type="time" dir="ltr" value={d.time} onChange={(e) => set({ time: e.target.value })} />
                </Field>
                <Field label="نویسنده">
                  <Input value={d.authorName} onChange={(e) => set({ authorName: e.target.value })} />
                </Field>
                {!isNew && (
                  <Button variant="ghost" className="text-danger" onClick={() => setDeleting(true)}>
                    حذف مطلب
                  </Button>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="تصویر شاخص" />
              <div className="p-5">
                <ImageUpload value={d.cover?.url ?? null} onChange={(img) => set({ cover: img })} previewClass="h-32" />
                {d.cover && (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ cover: null })}>
                    حذف تصویر
                  </Button>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="دسته و برچسب" />
              <div className="space-y-3 p-5">
                <Field label="دسته‌بندی">
                  <Select value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                    <option value="">بدون دسته</option>
                    {cats.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="برچسب‌ها (با ویرگول جدا کنید)">
                  <Input value={d.tags} onChange={(e) => set({ tags: e.target.value })} />
                </Field>
              </div>
            </Card>
            <Card>
              <CardHeader title="سئو" description="خالی بماند تا از عنوان و خلاصه استفاده شود." />
              <div className="space-y-3 p-5">
                <Field label="عنوان سئو">
                  <Input value={d.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
                </Field>
                <Field label="توضیح متا">
                  <Textarea rows={3} value={d.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
                </Field>
              </div>
            </Card>
          </div>
        </div>
      </PageState>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="حذف مطلب" description={d.title} confirmLabel="حذف" loading={del.isPending} onConfirm={() => del.mutate()} />
    </>
  );
}

function CategoryRow({ c, onDone }: { c: Category | null; onDone(): void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(c?.name ?? '');
  const [slug, setSlug] = useState(c?.slug ?? '');
  const [sort, setSort] = useState(String(c?.sort ?? 0));
  const save = useMutation({
    mutationFn: () => consoleApi(`/api/console/site/blog/categories/${c?.id ?? 'new'}`, { method: 'PUT', body: { name, slug: slug || slugify(name), sort: Number(sort) || 0 } }),
    onSuccess: () => {
      toast('دسته ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['blog-categories'] });
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
      <Field label="نام دسته">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="نامک">
        <Input value={slug} placeholder={slugify(name)} onChange={(e) => setSlug(e.target.value)} />
      </Field>
      <Field label="ترتیب" className="w-20">
        <Input dir="ltr" value={sort} onChange={(e) => setSort(e.target.value)} />
      </Field>
      <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
        ذخیره
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        انصراف
      </Button>
    </div>
  );
}

export function BlogCategories() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['blog-categories'], queryFn: () => consoleApi<Category[]>('/api/console/site/blog/categories') });
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const del = useMutation({
    mutationFn: (cid: string) => consoleApi(`/api/console/site/blog/categories/${cid}/delete`, { method: 'POST' }),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['blog-categories'] });
    },
  });
  return (
    <>
      <PageHeader title="دسته‌بندی‌های وبلاگ" description="با حذف یک دسته، مطالب آن بدون دسته می‌مانند." actions={<Button onClick={() => setEditing('new')}>دسته جدید</Button>} />
      <Card>
        <div className="space-y-3 p-5">
          {editing === 'new' && <CategoryRow c={null} onDone={() => setEditing(null)} />}
          <PageState query={q}>
            {q.data?.length === 0 && editing !== 'new' && <p className="text-sm text-muted">هنوز دسته‌ای تعریف نشده است.</p>}
            {q.data?.map((c) =>
              editing !== 'new' && editing?.id === c.id ? (
                <CategoryRow key={c.id} c={c} onDone={() => setEditing(null)} />
              ) : (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <p>
                    <span className="font-medium">{c.name}</span> <span className="text-sm text-muted">({c.slug} — {c.posts} مطلب)</span>
                  </p>
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>ویرایش</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(c)}>حذف</Button>
                  </div>
                </div>
              ),
            )}
          </PageState>
        </div>
      </Card>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="حذف دسته" description={deleting?.name} confirmLabel="حذف" loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} />
    </>
  );
}
