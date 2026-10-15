import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DayText, Dialog, EmptyState, Field, Input, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { BASE, folderPaths, Nav, num, STATUS, useApi, useCategories, useFolders, useServerErrors, type Category } from './common.js';

interface Policy { id: string; name: string; years: number; archived: boolean }

export function SettingsPage() {
  const a = useApi();
  const qc = useQueryClient();
  const folders = useFolders();
  const cats = useCategories();
  const policies = useQuery({ queryKey: ['documents', 'policies'], queryFn: () => a.get<Policy[]>('/retention-policies') });
  const due = useQuery({ queryKey: ['documents', 'retention-due'], queryFn: () => a.get<{ id: string; code: string; title: string; status: string; retention_until: string; category_name: string | null }[]>('/retention-due') });
  const [folderDlg, setFolderDlg] = useState<{ id: string | null; name: string; parentId: string } | null>(null);
  const [catDlg, setCatDlg] = useState<Category | 'new' | null>(null);
  const [polDlg, setPolDlg] = useState<Policy | 'new' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const removeFolder = useMutation({
    mutationFn: (id: string) => a.del(`/folders/${id}`),
    onSuccess: () => (toast('پوشه حذف شد'), setRemoving(null), void qc.invalidateQueries({ queryKey: ['documents'] })),
    onError: (e) => (setRemoving(null), toast(e instanceof Error ? e.message : 'انجام نشد', 'danger')),
  });
  const paths = folderPaths(folders.data ?? []);
  return (
    <>
      <PageHeader title="تنظیمات اسناد" description="پوشه‌ها، دسته‌ها (نیاز به تأیید و سیاست نگهداری) و اسنادی که دوره نگهداری آن‌ها تمام شده است." />
      <Nav />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="پوشه‌ها" actions={<Button size="sm" onClick={() => setFolderDlg({ id: null, name: '', parentId: '' })}>پوشه جدید</Button>} />
          <PageState query={folders} isEmpty={paths.length === 0} empty={<EmptyState title="پوشه‌ای تعریف نشده است" />}>
            <ul className="space-y-1 text-sm">
              {paths.map((f) => {
                const raw = folders.data!.find((x) => x.id === f.id)!;
                return (
                  <li key={f.id} className="flex items-center justify-between gap-2">
                    <span>{f.path} <span className="text-xs text-muted">({num(f.documents)} سند)</span></span>
                    <span>
                      <Button size="sm" variant="ghost" onClick={() => setFolderDlg({ id: f.id, name: raw.name, parentId: raw.parent_id ?? '' })}>ویرایش</Button>
                      <Button size="sm" variant="ghost" aria-label={`حذف ${f.path}`} onClick={() => setRemoving(f.id)}><Trash2 className="size-4" /></Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </PageState>
        </Card>
        <Card>
          <CardHeader title="دسته‌ها" actions={<Button size="sm" onClick={() => setCatDlg('new')}>دسته جدید</Button>} />
          <PageState query={cats} isEmpty={cats.data?.length === 0} empty={<EmptyState title="دسته‌ای تعریف نشده است" />}>
            <Table>
              <thead><tr><Th>نام</Th><Th>تأیید نسخه</Th><Th>نگهداری</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
              <tbody>
                {cats.data?.map((c) => (
                  <tr key={c.id}>
                    <Td>{c.name}{c.archived && <Badge className="ms-1">بایگانی</Badge>}</Td>
                    <Td>{c.requires_approval ? 'لازم' : 'ندارد'}</Td>
                    <Td>{c.policy_name ? `${c.policy_name} (${num(c.years)} سال)` : '—'}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => setCatDlg(c)}>ویرایش</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </PageState>
        </Card>
        <Card>
          <CardHeader title="سیاست‌های نگهداری" actions={<Button size="sm" onClick={() => setPolDlg('new')}>سیاست جدید</Button>} />
          <p className="mb-2 text-sm text-muted">دوره نگهداری از تاریخ تأیید نخستین نسخه شمرده می‌شود. پیش از پایان آن، سند تأییدشده حذف نمی‌شود.</p>
          <PageState query={policies} isEmpty={policies.data?.length === 0} empty={<EmptyState title="سیاستی تعریف نشده است" />}>
            <ul className="space-y-1 text-sm">
              {policies.data?.map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <span>{p.name} — {num(p.years)} سال{p.archived && ' (بایگانی)'}</span>
                  <Button size="sm" variant="ghost" onClick={() => setPolDlg(p)}>ویرایش</Button>
                </li>
              ))}
            </ul>
          </PageState>
        </Card>
        <Card>
          <CardHeader title="پایان دوره نگهداری" />
          <PageState query={due} isEmpty={due.data?.length === 0} empty={<EmptyState title="سندی منتظر تصمیم نیست" />}>
            <Table>
              <thead><tr><Th>سند</Th><Th>دسته</Th><Th>نگهداری تا</Th><Th>وضعیت</Th></tr></thead>
              <tbody>
                {due.data?.map((d) => (
                  <tr key={d.id}>
                    <Td><Link className="text-primary underline" to={`${BASE}/d/${d.id}`}>{d.code}</Link><div className="text-xs text-muted">{d.title}</div></Td>
                    <Td>{d.category_name ?? '—'}</Td><Td><DayText value={d.retention_until} /></Td><Td>{STATUS[d.status]?.label}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </PageState>
        </Card>
      </div>
      {folderDlg && <FolderDialog init={folderDlg} onClose={() => setFolderDlg(null)} />}
      {catDlg && <CategoryDialog category={catDlg === 'new' ? null : catDlg} policies={policies.data ?? []} onClose={() => setCatDlg(null)} />}
      {polDlg && <PolicyDialog policy={polDlg === 'new' ? null : polDlg} onClose={() => setPolDlg(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="حذف پوشه" description="فقط پوشه خالی (بدون زیرپوشه و سند) حذف می‌شود." confirmLabel="حذف" loading={removeFolder.isPending} onConfirm={() => removing && removeFolder.mutate(removing)} />
    </>
  );
}

function FolderDialog({ init, onClose }: { init: { id: string | null; name: string; parentId: string }; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const folders = useFolders();
  const [name, setName] = useState(init.name);
  const [parentId, setParentId] = useState(init.parentId);
  const save = useMutation({
    mutationFn: () => (init.id ? a.put(`/folders/${init.id}`, { name, parentId: parentId || null }) : a.post('/folders', { name, parentId: parentId || null })),
    onSuccess: () => (toast('پوشه ذخیره شد'), void qc.invalidateQueries({ queryKey: ['documents'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={init.id ? 'ویرایش پوشه' : 'پوشه جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="نام" required error={err.fields.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="پوشه والد"><Select value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">— (ریشه)</option>{folderPaths(folders.data ?? []).filter((f) => f.id !== init.id).map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}</Select></Field>
      </div>
    </Dialog>
  );
}

function CategoryDialog({ category, policies, onClose }: { category: Category | null; policies: Policy[]; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [name, setName] = useState(category?.name ?? '');
  const [requiresApproval, setRequires] = useState(category?.requires_approval ?? true);
  const [policy, setPolicy] = useState(category?.retention_policy_id ?? '');
  const [archived, setArchived] = useState(category?.archived ?? false);
  const body = () => ({ name, requiresApproval, retentionPolicyId: policy || null, archived });
  const save = useMutation({
    mutationFn: () => (category ? a.put(`/categories/${category.id}`, body()) : a.post('/categories', body())),
    onSuccess: () => (toast('دسته ذخیره شد'), void qc.invalidateQueries({ queryKey: ['documents'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={category ? 'ویرایش دسته' : 'دسته جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="نام" required error={err.fields.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Checkbox label="هر نسخه جدید تأیید لازم دارد (گردش «تأیید نسخه سند»)" checked={requiresApproval} onChange={(e) => setRequires(e.target.checked)} />
        <Field label="سیاست نگهداری"><Select value={policy} onChange={(e) => setPolicy(e.target.value)}><option value="">—</option>{policies.filter((p) => !p.archived || p.id === policy).map((p) => <option key={p.id} value={p.id}>{p.name} ({num(p.years)} سال)</option>)}</Select></Field>
        {category && <Checkbox label="بایگانی (برای سند جدید انتخاب نمی‌شود)" checked={archived} onChange={(e) => setArchived(e.target.checked)} />}
      </div>
    </Dialog>
  );
}

function PolicyDialog({ policy, onClose }: { policy: Policy | null; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [name, setName] = useState(policy?.name ?? '');
  const [years, setYears] = useState(String(policy?.years ?? 5));
  const [archived, setArchived] = useState(policy?.archived ?? false);
  const body = () => ({ name, years: Number(years) || 0, archived });
  const save = useMutation({
    mutationFn: () => (policy ? a.put(`/retention-policies/${policy.id}`, body()) : a.post('/retention-policies', body())),
    onSuccess: () => (toast('سیاست ذخیره شد'), void qc.invalidateQueries({ queryKey: ['documents'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={policy ? 'ویرایش سیاست نگهداری' : 'سیاست نگهداری جدید'} description="تغییر مدت، تاریخ پایان نگهداری همه اسناد مرتبط را دوباره محاسبه می‌کند." footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="نام" required error={err.fields.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="مدت (سال)" required error={err.fields.years}><Input inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value.replace(/\D/g, ''))} /></Field>
        {policy && <Checkbox label="بایگانی" checked={archived} onChange={(e) => setArchived(e.target.checked)} />}
      </div>
    </Dialog>
  );
}
