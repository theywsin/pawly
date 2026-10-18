import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, X } from 'lucide-react';
import { Badge, Button, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Tabs, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory, useHost } from '@mohandesyar/module-sdk/web';
import { BASE, CONFIDENTIALITY, folderPaths, LINK_TYPE, Nav, num, STATUS, useApi, useCategories, useFolders, useServerErrors } from './common.js';
import { LinkPicker, type PickedLink } from './links.js';

interface Doc { id: string; code: string; title: string; folder_id: string | null; category_name: string | null; tags: string[]; confidentiality: string; status: string; owner_id: string; current_version: number | null; expires_on: string | null; expired: boolean; expiring: boolean; has_pending: boolean; links: { type: string; id: string; label: string }[] }

export function DocumentsPage() {
  const a = useApi();
  const dir = useDirectory();
  const canCreate = useCan('documents.manage');
  const folders = useFolders();
  const cats = useCategories();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState('');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams();
  if (search) params.set('q', search);
  if (folder) params.set('folderId', folder);
  if (category) params.set('categoryId', category);
  if (view === 'expiring') params.set('expiring', '1');
  else if (view) params.set('status', view);
  const list = useQuery({ queryKey: ['documents', 'list', params.toString()], queryFn: () => a.get<Doc[]>(`/documents?${params}`) });
  const paths = folderPaths(folders.data ?? []);
  return (
    <>
      <PageHeader
        title="اسناد"
        description="هر نسخه جدید پس از تأیید (اگر دسته آن تأیید بخواهد) نسخه جاری می‌شود و دیگر تغییر نمی‌کند. اسناد محرمانه و سری فقط برای مالک و افراد فهرست دسترسی نمایش داده می‌شوند."
        actions={
          <>
            <ExportMenu filename="documents" title="فهرست اسناد" rows={list.data} columns={[
              { header: 'شماره', value: (d) => d.code }, { header: 'عنوان', value: (d) => d.title }, { header: 'دسته', value: (d) => d.category_name },
              { header: 'برچسب‌ها', value: (d) => d.tags.join('، ') }, { header: 'محرمانگی', value: (d) => CONFIDENTIALITY[d.confidentiality]?.label }, { header: 'وضعیت', value: (d) => STATUS[d.status]?.label },
              { header: 'نسخه', value: (d) => d.current_version, kind: 'number' }, { header: 'انقضا', value: (d) => d.expires_on }, { header: 'مالک', value: (d) => dir.name(d.owner_id) },
            ]} />
            {canCreate && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> سند جدید</Button>}
          </>
        }
      />
      <Nav />
      <form className="mb-4 flex flex-wrap items-end gap-3" role="search" onSubmit={(e) => (e.preventDefault(), setSearch(q.trim()))}>
        <Field label="جست‌وجو در شماره، عنوان، شرح، برچسب و نام فایل" className="min-w-64 flex-1"><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Button type="submit" variant="secondary">جست‌وجو</Button>
        <Field label="پوشه"><Select value={folder} onChange={(e) => setFolder(e.target.value)}><option value="">همه</option>{paths.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}</Select></Field>
        <Field label="دسته"><Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">همه</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      </form>
      <Tabs label="نمایش" value={view} onChange={setView} items={[{ key: '', label: 'همه' }, { key: 'active', label: 'معتبر' }, { key: 'draft', label: 'پیش‌نویس' }, { key: 'expiring', label: 'رو به انقضا' }, { key: 'obsolete', label: 'منسوخ' }]} />
      <PageState query={list} isEmpty={list.data?.length === 0} empty={<EmptyState icon={<FileText className="size-8" />} title={search ? 'سندی با این جست‌وجو یافت نشد' : 'سندی وجود ندارد'} />}>
        <Table>
          <thead><tr><Th>شماره</Th><Th>عنوان</Th><Th>دسته / برچسب</Th><Th>اتصال</Th><Th>انقضا</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {list.data?.map((d) => (
              <tr key={d.id}>
                <Td className="whitespace-nowrap"><Link className="text-primary underline" to={`${BASE}/d/${d.id}`}>{d.code}</Link></Td>
                <Td>{d.title}{d.confidentiality !== 'internal' && <Badge tone={CONFIDENTIALITY[d.confidentiality]!.tone} className="ms-1">{CONFIDENTIALITY[d.confidentiality]!.label}</Badge>}<div className="text-xs text-muted">مالک: {dir.name(d.owner_id)}</div></Td>
                <Td>{d.category_name ?? '—'}{d.tags.length > 0 && <div className="text-xs text-muted">{d.tags.join('، ')}</div>}</Td>
                <Td className="text-xs">{d.links.map((l) => <div key={`${l.type}${l.id}`}>{LINK_TYPE[l.type]}: {l.label}</div>)}</Td>
                <Td>{d.expires_on ? <><DayText value={d.expires_on} />{d.expired ? <Badge tone="danger" className="ms-1">منقضی</Badge> : d.expiring && <Badge tone="warning" className="ms-1">نزدیک</Badge>}</> : '—'}</Td>
                <Td><Badge tone={STATUS[d.status]!.tone}>{STATUS[d.status]!.label}</Badge>{d.current_version && <div className="text-xs text-muted">نسخه {num(d.current_version)}</div>}{d.has_pending && <div className="text-xs text-muted">نسخه در انتظار تأیید</div>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const host = useHost();
  const qc = useQueryClient();
  const nav = useNavigate();
  const err = useServerErrors();
  const folders = useFolders();
  const cats = useCategories();
  const companyScope = useCan('documents.admin');
  const [v, setV] = useState({ code: '', title: '', description: '', folderId: '', categoryId: '', confidentiality: 'internal', tags: '', note: '', remindDays: '30' });
  const [expires, setExpires] = useState<string | null>(null);
  const [links, setLinks] = useState<PickedLink[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('فایل سند را انتخاب کنید');
      if (!host.upload) throw new Error('بارگذاری فایل در دسترس نیست');
      const up = await host.upload(file, { module: 'documents', confidentiality: v.confidentiality === 'internal' ? 'internal' : 'confidential' });
      return a.post<{ id: string; version: number; pending: boolean }>('/documents', {
        code: v.code, title: v.title, description: v.description, folderId: v.folderId || null, categoryId: v.categoryId || null, confidentiality: v.confidentiality,
        tags: v.tags.split(/[،,]/).map((x) => x.trim()).filter(Boolean), expiresOn: expires, remindDays: Number(v.remindDays) || 0, note: v.note,
        links: links.map((l) => ({ type: l.type, id: l.id })), fileId: up.id,
      });
    },
    onSuccess: (r) => (toast(r.pending ? 'سند ثبت و نسخه ۱ برای تأیید ارسال شد' : 'سند ثبت شد'), void qc.invalidateQueries({ queryKey: ['documents'] }), nav(`${BASE}/d/${r.id}`)),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="سند جدید" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="شماره سند" required error={f.code}><Input dir="ltr" value={v.code} onChange={(e) => set('code')(e.target.value)} /></Field>
        <Field label="عنوان" required error={f.title}><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
        <Field label="پوشه"><Select value={v.folderId} onChange={(e) => set('folderId')(e.target.value)}><option value="">—</option>{folderPaths(folders.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</Select></Field>
        <Field label="دسته" hint="دسته تعیین می‌کند نسخه‌ها تأیید لازم دارند یا نه و دوره نگهداری چقدر است.">
          <Select value={v.categoryId} onChange={(e) => set('categoryId')(e.target.value)}><option value="">— (تأیید لازم)</option>{(cats.data ?? []).filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}{c.requires_approval ? '' : ' (بدون تأیید)'}</option>)}</Select>
        </Field>
        <Field label="سطح محرمانگی"><Select value={v.confidentiality} onChange={(e) => set('confidentiality')(e.target.value)}>{Object.entries(CONFIDENTIALITY).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</Select></Field>
        <Field label="برچسب‌ها (با ویرگول جدا کنید)" error={f.tags}><Input value={v.tags} onChange={(e) => set('tags')(e.target.value)} /></Field>
        <Field label="تاریخ انقضا"><DateInput value={expires} onChange={setExpires} /></Field>
        <Field label="یادآوری چند روز پیش از انقضا"><Input inputMode="numeric" value={v.remindDays} onChange={(e) => set('remindDays')(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="شرح" className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <Field label="فایل نسخه ۱" required error={f.fileId}><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="یادداشت نسخه"><Input value={v.note} onChange={(e) => set('note')(e.target.value)} /></Field>
      </div>
      <h3 className="mb-2 mt-6 font-semibold">اتصال‌ها</h3>
      {!companyScope && <p className="mb-2 text-sm text-muted">سند را دست‌کم به یکی از پروژه‌هایی که عضو آن هستید متصل کنید.</p>}
      {links.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2 text-sm">
          {links.map((l) => (
            <li key={`${l.type}${l.id}`} className="flex items-center gap-1 rounded-full border border-border px-3 py-1">
              {LINK_TYPE[l.type]}: {l.label}
              <button type="button" aria-label={`حذف اتصال ${l.label}`} onClick={() => setLinks((s) => s.filter((x) => x !== l))}><X className="size-3" /></button>
            </li>
          ))}
        </ul>
      )}
      <LinkPicker onPick={(l) => setLinks((s) => (s.some((x) => x.type === l.type && x.id === l.id) ? s : [...s, l]))} />
    </Dialog>
  );
}
