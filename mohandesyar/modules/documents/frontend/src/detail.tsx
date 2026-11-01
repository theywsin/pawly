import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, DateInput, DateText, DayText, DescriptionList, Dialog, Field, Input, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useDirectory, useHost, useMe } from '@mohandesyar/module-sdk/web';
import { BASE, CONFIDENTIALITY, folderPaths, LINK_TYPE, Nav, num, size, STATUS, useApi, useCategories, useFolders, useServerErrors, VERSION_STATUS } from './common.js';
import { LinkPicker } from './links.js';

interface Detail {
  document: { id: string; code: string; title: string; description: string; folder_id: string | null; folder_name: string | null; category_id: string | null; category_name: string | null; tags: string[]; confidentiality: string; status: string; owner_id: string; current_version: number | null; expires_on: string | null; remind_days: number; expired: boolean; effective_on: string | null; retention_until: string | null; disposed_at: string | null; disposed_by: string | null };
  versions: { id: string; version: number; file_name: string; file_size: number; note: string; status: string; approvers: string[]; created_by: string; created_at: string; has_file: boolean }[];
  links: { id: string; entity_type: string; entity_id: string; label: string }[];
  access: { user_id: string; can_edit: boolean }[];
  log: { action: string; version: number | null; user_id: string; at: string }[] | null;
  canEdit: boolean;
  canManageAccess: boolean;
  canDispose: boolean;
  underRetention: boolean;
}

export function DocumentPage() {
  const { id = '' } = useParams();
  const a = useApi();
  const host = useHost();
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const dir = useDirectory();
  const [dialog, setDialog] = useState<'edit' | 'version' | 'link' | 'access' | 'obsolete' | 'dispose' | 'delete' | null>(null);
  const q = useQuery({ queryKey: ['documents', 'doc', id], queryFn: () => a.get<Detail>(`/documents/${id}`) });
  const refresh = (msg: string) => (toast(msg), setDialog(null), void qc.invalidateQueries({ queryKey: ['documents'] }));
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'انجام نشد', 'danger');
  const download = async (vid: string) => {
    try {
      const r = await a.get<{ url: string }>(`/documents/${id}/versions/${vid}/url`);
      window.location.assign(r.url);
    } catch (e) {
      fail(e);
    }
  };
  const withdraw = useMutation({ mutationFn: (vid: string) => a.del(`/documents/${id}/versions/${vid}`), onSuccess: () => refresh('نسخه پس گرفته شد'), onError: fail });
  const unlink = useMutation({ mutationFn: (lid: string) => a.del(`/documents/${id}/links/${lid}`), onSuccess: () => refresh('اتصال حذف شد'), onError: fail });
  const obsolete = useMutation({ mutationFn: () => a.post(`/documents/${id}/obsolete`), onSuccess: () => refresh('سند منسوخ شد'), onError: fail });
  const remove = useMutation({ mutationFn: () => a.del(`/documents/${id}`), onSuccess: () => (toast('سند حذف شد'), void qc.invalidateQueries({ queryKey: ['documents'] }), nav(`${BASE}/list`)), onError: fail });
  const d = q.data;
  const doc = d?.document;
  const isOwner = doc?.owner_id === me.user.id;
  return (
    <>
      <PageHeader
        title={doc ? `${doc.code} — ${doc.title}` : 'سند'}
        description={doc && <span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS[doc.status]!.tone}>{STATUS[doc.status]!.label}</Badge><Badge tone={CONFIDENTIALITY[doc.confidentiality]!.tone}>{CONFIDENTIALITY[doc.confidentiality]!.label}</Badge>{doc.expired && <Badge tone="danger">منقضی‌شده</Badge>}</span>}
        actions={d && doc && (
          <>
            {d.canEdit && doc.status !== 'obsolete' && <Button onClick={() => setDialog('version')}>نسخه جدید</Button>}
            {d.canEdit && <Button variant="secondary" onClick={() => setDialog('edit')}>ویرایش مشخصات</Button>}
            {d.canEdit && <Button variant="secondary" onClick={() => setDialog('link')}>اتصال</Button>}
            {d.canManageAccess && doc.confidentiality !== 'internal' && <Button variant="secondary" onClick={() => setDialog('access')}>دسترسی</Button>}
            {d.canEdit && doc.status === 'active' && <Button variant="ghost" onClick={() => setDialog('obsolete')}>منسوخ کردن</Button>}
            {d.canDispose && <Button variant="danger" onClick={() => setDialog('dispose')}>امحا</Button>}
            {d.canEdit && doc.status === 'draft' && (isOwner || me.permissions.includes('documents.admin')) && <Button variant="ghost" onClick={() => setDialog('delete')}>حذف</Button>}
          </>
        )}
      />
      <Nav />
      <PageState query={q}>
        {d && doc && (
          <div className="space-y-6">
            {doc.status === 'disposed' && <Alert tone="warning">این سند پس از پایان دوره نگهداری امحا شده است؛ فایل‌ها پاک شده و فقط سابقه باقی است.</Alert>}
            <DescriptionList items={[
              { label: 'مالک', value: dir.name(doc.owner_id) },
              { label: 'پوشه', value: doc.folder_name ?? '—' },
              { label: 'دسته', value: doc.category_name ?? '—' },
              { label: 'برچسب‌ها', value: doc.tags.join('، ') || '—' },
              { label: 'انقضا', value: doc.expires_on ? <><DayText value={doc.expires_on} /> (یادآوری {num(doc.remind_days)} روز قبل)</> : '—' },
              { label: 'تاریخ اعتبار نسخه اول', value: doc.effective_on ? <DayText value={doc.effective_on} /> : '—' },
              { label: 'نگهداری تا', value: doc.retention_until ? <><DayText value={doc.retention_until} />{d.underRetention && ' (حذف ممنوع)'}</> : 'سیاست نگهداری ندارد' },
            ]} />
            {doc.description && <p className="whitespace-pre-line text-sm">{doc.description}</p>}
            <section>
              <h2 className="mb-2 font-semibold">نسخه‌ها</h2>
              {d.versions.length === 0 ? <p className="text-sm text-muted">هنوز نسخه تأییدشده‌ای ندارد.</p> : (
                <Table>
                  <thead><tr><Th>نسخه</Th><Th>فایل</Th><Th>یادداشت</Th><Th>بارگذاری</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                  <tbody>
                    {d.versions.map((x) => (
                      <tr key={x.id}>
                        <Td className="tabular-nums">{num(x.version)}</Td>
                        <Td>{x.file_name}<div className="text-xs text-muted">{size(x.file_size)}</div></Td>
                        <Td>{x.note || '—'}</Td>
                        <Td>{dir.name(x.created_by)}<div className="text-xs text-muted"><DateText value={x.created_at} /></div></Td>
                        <Td>
                          <Badge tone={VERSION_STATUS[x.status]!.tone}>{VERSION_STATUS[x.status]!.label}</Badge>
                          {x.approvers.length > 0 && <div className="text-xs text-muted">{x.status === 'rejected' ? 'رد' : 'تأیید'}: {x.approvers.map(dir.name).join('، ')}</div>}
                          {x.status === 'pending' && <div className="text-xs"><Link className="text-primary underline" to="/app/approvals">کارتابل تأیید</Link></div>}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {x.has_file && <Button size="sm" variant="ghost" onClick={() => void download(x.id)} aria-label={`دانلود نسخه ${num(x.version)}`}><Download className="size-4" /></Button>}
                          {x.status === 'pending' && (d.canEdit || x.created_by === me.user.id) && <Button size="sm" variant="ghost" loading={withdraw.isPending} onClick={() => withdraw.mutate(x.id)}>پس گرفتن</Button>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </section>
            <section>
              <h2 className="mb-2 font-semibold">اتصال‌ها</h2>
              {d.links.length === 0 ? <p className="text-sm text-muted">به موردی متصل نیست.</p> : (
                <ul className="space-y-1 text-sm">
                  {d.links.map((l) => (
                    <li key={l.id} className="flex items-center gap-2">
                      {LINK_TYPE[l.entity_type]}: {l.entity_type === 'user' ? dir.name(l.entity_id) : l.label}
                      {d.canEdit && <Button size="sm" variant="ghost" aria-label={`حذف اتصال ${l.label}`} onClick={() => unlink.mutate(l.id)}><Trash2 className="size-4" /></Button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {doc.confidentiality !== 'internal' && (d.canManageAccess || d.access.length > 0) && (
              <section>
                <h2 className="mb-2 font-semibold">فهرست دسترسی</h2>
                {d.access.length === 0 ? <p className="text-sm text-muted">فقط مالک{doc.confidentiality === 'confidential' && ' و مدیران اسناد'} به این سند دسترسی دارند.</p> : (
                  <ul className="text-sm">{d.access.map((x) => <li key={x.user_id}>{dir.name(x.user_id)} — {x.can_edit ? 'مشاهده و ویرایش' : 'فقط مشاهده'}</li>)}</ul>
                )}
              </section>
            )}
            {d.log && (
              <section>
                <h2 className="mb-2 font-semibold">سابقه مشاهده و دانلود</h2>
                {d.log.length === 0 ? <p className="text-sm text-muted">ثبت نشده است.</p> : (
                  <Table>
                    <thead><tr><Th>کاربر</Th><Th>عمل</Th><Th>نسخه</Th><Th>زمان</Th></tr></thead>
                    <tbody>{d.log.map((l, i) => <tr key={i}><Td>{dir.name(l.user_id)}</Td><Td>{l.action === 'view' ? 'مشاهده' : 'دانلود'}</Td><Td className="tabular-nums">{num(l.version)}</Td><Td><DateText value={l.at} /></Td></tr>)}</tbody>
                  </Table>
                )}
              </section>
            )}
          </div>
        )}
      </PageState>
      {dialog === 'version' && d && <VersionDialog id={id} confidentiality={d.document.confidentiality} upload={host.upload} onDone={(pending) => refresh(pending ? 'نسخه جدید برای تأیید ارسال شد' : 'نسخه جدید ثبت شد')} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && d && <EditDialog d={d} onDone={() => refresh('مشخصات ذخیره شد')} onClose={() => setDialog(null)} />}
      {dialog === 'link' && <LinkDialog id={id} onDone={() => refresh('اتصال ثبت شد')} onClose={() => setDialog(null)} />}
      {dialog === 'access' && d && <AccessDialog id={id} access={d.access} ownerId={d.document.owner_id} onDone={() => refresh('دسترسی ذخیره شد')} onClose={() => setDialog(null)} />}
      {dialog === 'dispose' && <DisposeDialog id={id} onDone={() => refresh('سند امحا شد')} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={dialog === 'obsolete'} onOpenChange={(o) => !o && setDialog(null)} title="منسوخ کردن سند" tone="primary" description="سند منسوخ نسخه جدید نمی‌گیرد ولی تا پایان دوره نگهداری باقی می‌ماند." confirmLabel="منسوخ کن" loading={obsolete.isPending} onConfirm={() => obsolete.mutate()} />
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title="حذف سند" description="این سند هیچ نسخه تأییدشده‌ای ندارد؛ با حذف، فایل‌های آن هم پاک می‌شوند." confirmLabel="حذف" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

type Upload = ReturnType<typeof useHost>['upload'];

function VersionDialog({ id, confidentiality, upload, onDone, onClose }: { id: string; confidentiality: string; upload: Upload; onDone: (pending: boolean) => void; onClose: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('فایل را انتخاب کنید');
      if (!upload) throw new Error('بارگذاری فایل در دسترس نیست');
      const up = await upload(file, { module: 'documents', confidentiality: confidentiality === 'internal' ? 'internal' : 'confidential' });
      return a.post<{ pending: boolean }>(`/documents/${id}/versions`, { fileId: up.id, note });
    },
    onSuccess: (r) => onDone(r.pending),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="نسخه جدید" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>بارگذاری</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="فایل" required><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="شرح تغییرات"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function EditDialog({ d, onDone, onClose }: { d: Detail; onDone: () => void; onClose: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const folders = useFolders();
  const cats = useCategories();
  const doc = d.document;
  const [v, setV] = useState({ code: doc.code, title: doc.title, description: doc.description, folderId: doc.folder_id ?? '', categoryId: doc.category_id ?? '', confidentiality: doc.confidentiality, tags: doc.tags.join('، '), remindDays: String(doc.remind_days) });
  const [expires, setExpires] = useState<string | null>(doc.expires_on);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.put(`/documents/${doc.id}`, {
      code: v.code, title: v.title, description: v.description, folderId: v.folderId || null, categoryId: v.categoryId || null, confidentiality: v.confidentiality,
      tags: v.tags.split(/[،,]/).map((x) => x.trim()).filter(Boolean), expiresOn: expires, remindDays: Number(v.remindDays) || 0,
    }),
    onSuccess: onDone,
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="ویرایش مشخصات سند" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="شماره سند" required error={f.code}><Input dir="ltr" value={v.code} onChange={(e) => set('code')(e.target.value)} /></Field>
        <Field label="عنوان" required error={f.title}><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
        <Field label="پوشه"><Select value={v.folderId} onChange={(e) => set('folderId')(e.target.value)}><option value="">—</option>{folderPaths(folders.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</Select></Field>
        <Field label="دسته"><Select value={v.categoryId} onChange={(e) => set('categoryId')(e.target.value)}><option value="">—</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="سطح محرمانگی" hint={d.canManageAccess ? undefined : 'فقط مالک یا مدیر اسناد تغییر می‌دهد'}>
          <Select disabled={!d.canManageAccess} value={v.confidentiality} onChange={(e) => set('confidentiality')(e.target.value)}>{Object.entries(CONFIDENTIALITY).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</Select>
        </Field>
        <Field label="برچسب‌ها"><Input value={v.tags} onChange={(e) => set('tags')(e.target.value)} /></Field>
        <Field label="تاریخ انقضا"><DateInput value={expires} onChange={setExpires} /></Field>
        <Field label="یادآوری چند روز پیش از انقضا"><Input inputMode="numeric" value={v.remindDays} onChange={(e) => set('remindDays')(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="شرح" className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function LinkDialog({ id, onDone, onClose }: { id: string; onDone: () => void; onClose: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const save = useMutation({ mutationFn: (l: { type: string; id: string }) => a.post(`/documents/${id}/links`, l), onSuccess: onDone, onError: err.set });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="اتصال سند" description="با انتخاب، اتصال ثبت می‌شود." footer={<Button variant="ghost" onClick={onClose}>بستن</Button>}>
      {err.banner}
      <LinkPicker onPick={(l) => (err.clear(), save.mutate({ type: l.type, id: l.id }))} />
    </Dialog>
  );
}

function AccessDialog({ id, access, ownerId, onDone, onClose }: { id: string; access: Detail['access']; ownerId: string; onDone: () => void; onClose: () => void }) {
  const a = useApi();
  const dir = useDirectory();
  const err = useServerErrors();
  const [list, setList] = useState(access.map((x) => ({ userId: x.user_id, canEdit: x.can_edit })));
  const [pick, setPick] = useState('');
  const save = useMutation({ mutationFn: () => a.put(`/documents/${id}/access`, { users: list }), onSuccess: onDone, onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="فهرست دسترسی" description="فقط افراد این فهرست (و مالک) سند محرمانه یا سری را می‌بینند. حق ویرایش فقط برای کسانی مؤثر است که مجوز ثبت سند دارند." footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="flex items-end gap-2">
        <Field label="افزودن کاربر" className="flex-1">
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">انتخاب کنید</option>
            {dir.users.filter((u) => u.id !== ownerId && !list.some((x) => x.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        </Field>
        <Button variant="secondary" disabled={!pick} onClick={() => (setList((s) => [...s, { userId: pick, canEdit: false }]), setPick(''))}>افزودن</Button>
      </div>
      <ul className="mt-4 space-y-2">
        {list.map((x) => (
          <li key={x.userId} className="flex items-center justify-between gap-2">
            <span>{dir.name(x.userId)}</span>
            <span className="flex items-center gap-3">
              <Checkbox label="ویرایش" checked={x.canEdit} onChange={(e) => setList((s) => s.map((y) => (y.userId === x.userId ? { ...y, canEdit: e.target.checked } : y)))} />
              <Button size="sm" variant="ghost" aria-label={`حذف ${dir.name(x.userId)}`} onClick={() => setList((s) => s.filter((y) => y.userId !== x.userId))}><Trash2 className="size-4" /></Button>
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function DisposeDialog({ id, onDone, onClose }: { id: string; onDone: () => void; onClose: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const [reason, setReason] = useState('');
  const save = useMutation({ mutationFn: () => a.post(`/documents/${id}/dispose`, { reason }), onSuccess: onDone, onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="امحای سند" description="فایل همه نسخه‌ها برای همیشه پاک می‌شود؛ مشخصات، سابقه نسخه‌ها و دسترسی‌ها به‌عنوان مدرک باقی می‌مانند." footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant="danger" loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>امحا</Button></>}>
      {err.banner}
      <Field label="دلیل و مستند امحا" required error={err.fields.reason}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Dialog>
  );
}
