import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, Dialog, Field, Input, PageHeader, PageState, Select, toast } from '@mohandesyar/ui';
import { appApi } from '../../../lib/api.js';
import { errorMessage } from '../../../lib/errors.js';
import { useAppSession } from '../../../lib/session.js';
import type { Member } from './Members.js';

type Scope = 'company' | 'unit' | 'project' | 'own';
interface Grant {
  permission: string;
  scope: Scope;
}
interface Role {
  id: string;
  key: string;
  name: string;
  is_system: boolean;
  module_id: string | null;
  grants: Grant[];
}
interface Permission {
  key: string;
  moduleId: string;
  moduleName: string;
  label: string;
  scopes: Scope[];
}

const SCOPE_LABEL: Record<Scope, string> = { company: 'همه موارد شرکت', unit: 'واحد خودش', project: 'پروژه‌های خودش', own: 'فقط موارد خودش' };

const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => appApi<Role[]>('/api/core/roles') });

/** Whether a role's (possibly wildcard) grants cover a permission. */
function covers(grants: Grant[], key: string): Grant | undefined {
  return grants.find((g) => g.permission === key || (g.permission.includes('*') && new RegExp(`^${g.permission.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(key)));
}

function RoleEditor({ role, catalogue, onClose }: { role: Role | null; catalogue: Permission[]; onClose(): void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(role?.name ?? '');
  // Wildcard grants of built-in roles are expanded into concrete permissions for editing.
  const [grants, setGrants] = useState<Map<string, Scope>>(() => {
    const m = new Map<string, Scope>();
    for (const p of catalogue) {
      const g = role ? covers(role.grants, p.key) : undefined;
      if (g) m.set(p.key, p.scopes.includes(g.scope) ? g.scope : p.scopes[0]!);
    }
    return m;
  });
  const groups = useMemo(() => {
    const out = new Map<string, Permission[]>();
    for (const p of catalogue) out.set(p.moduleName, [...(out.get(p.moduleName) ?? []), p]);
    return [...out.entries()];
  }, [catalogue]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, grants: [...grants.entries()].map(([permission, scope]) => ({ permission, scope })) };
      return role ? appApi(`/api/core/roles/${role.key}`, { method: 'PUT', body }) : appApi('/api/core/roles', { method: 'POST', body });
    },
    onSuccess: () => {
      toast('نقش ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const toggle = (p: Permission, on: boolean) => {
    const next = new Map(grants);
    if (on) next.set(p.key, p.scopes.includes('company') ? 'company' : p.scopes[0]!);
    else next.delete(p.key);
    setGrants(next);
  };
  const setModule = (perms: Permission[], on: boolean) => {
    const next = new Map(grants);
    for (const p of perms) {
      if (on) next.set(p.key, next.get(p.key) ?? (p.scopes.includes('company') ? 'company' : p.scopes[0]!));
      else next.delete(p.key);
    }
    setGrants(next);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={role ? `ویرایش نقش «${role.name}»` : 'نقش جدید'}
      description="تیک هر کار یعنی دارنده این نقش آن کار را انجام می‌دهد. «محدوده» مشخص می‌کند روی همه موارد شرکت یا فقط موارد خودش."
      footer={
        <Button loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>
          ذخیره نقش
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="نام نقش">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً کارشناس فروش" />
        </Field>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pe-1">
          {groups.map(([moduleName, perms]) => {
            const all = perms.every((p) => grants.has(p.key));
            return (
              <fieldset key={moduleName} className="rounded-lg border border-border p-3">
                <legend className="px-1">
                  <Checkbox label={<strong>{moduleName}</strong>} checked={all} onChange={(e) => setModule(perms, e.target.checked)} />
                </legend>
                <ul className="space-y-2">
                  {perms.map((p) => (
                    <li key={p.key} className="flex flex-wrap items-center justify-between gap-2">
                      <Checkbox label={p.label} checked={grants.has(p.key)} onChange={(e) => toggle(p, e.target.checked)} />
                      {grants.has(p.key) && p.scopes.length > 1 && (
                        <Select
                          aria-label={`محدوده ${p.label}`}
                          className="h-8 w-40 text-xs"
                          value={grants.get(p.key)}
                          onChange={(e) => setGrants(new Map(grants).set(p.key, e.target.value as Scope))}
                        >
                          {p.scopes.map((s) => (
                            <option key={s} value={s}>
                              {SCOPE_LABEL[s]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

/** Organisation roles: built-in ones (editable except the administrator) and the organisation's own. */
export function RolesPage() {
  const { me } = useAppSession();
  const qc = useQueryClient();
  const canManage = me.permissions.includes('core.role.manage');
  const roles = useRoles();
  const catalogue = useQuery({ queryKey: ['permission-catalogue'], queryFn: () => appApi<Permission[]>('/api/core/permissions') });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const del = useMutation({
    mutationFn: (key: string) => appApi(`/api/core/roles/${key}/delete`, { method: 'POST' }),
    onSuccess: () => {
      setDeleting(null);
      toast('نقش حذف شد');
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => {
      setDeleting(null);
      toast(errorMessage(e), 'danger');
    },
  });
  const count = (r: Role) => (catalogue.data ?? []).filter((p) => covers(r.grants, p.key)).length;
  return (
    <>
      <PageHeader
        title="نقش‌ها و دسترسی‌ها"
        description="برای هر شغل یک نقش بسازید و دسترسی ماژول‌ها را تیک بزنید؛ سپس در «کاربران و نقش‌ها» نقش را به کارمند بدهید."
        actions={
          <>
            <Link to="/app/settings/members" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-surface-2">
              کاربران
            </Link>
            {canManage && (
              <Button onClick={() => setEditing('new')}>
                <Plus className="size-4" /> نقش جدید
              </Button>
            )}
          </>
        }
      />
      <PageState query={roles}>
        <ul className="grid gap-4 md:grid-cols-2">
          {roles.data?.map((r) => (
            <li key={r.id}>
              <Card>
                <CardHeader
                  title={r.name}
                  description={r.key === 'company_admin' ? 'همه دسترسی‌ها (قابل تغییر نیست)' : `${count(r).toLocaleString('fa-IR')} دسترسی`}
                  actions={r.is_system ? <Badge>پیش‌فرض</Badge> : r.module_id ? <Badge tone="info">نقش ماژول</Badge> : <Badge tone="success">نقش سازمان</Badge>}
                />
                {canManage && r.key !== 'company_admin' && (
                  <div className="flex gap-2 px-5 pb-4">
                    <Button size="sm" variant="secondary" disabled={!catalogue.data} onClick={() => setEditing(r)}>
                      <ShieldCheck className="size-4" /> ویرایش دسترسی‌ها
                    </Button>
                    {!r.is_system && !r.module_id && (
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(r)} aria-label={`حذف نقش ${r.name}`}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </PageState>
      {editing && catalogue.data && <RoleEditor role={editing === 'new' ? null : editing} catalogue={catalogue.data} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="حذف نقش" description={deleting?.name} confirmLabel="حذف" loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.key)} />
    </>
  );
}

/** A member's roles (each for all companies or one) and whether the account is active. */
export function MemberRolesDialog({ member, onClose }: { member: Member; onClose(): void }) {
  const { me } = useAppSession();
  const qc = useQueryClient();
  const roles = useRoles();
  const [rows, setRows] = useState(member.roles.map((r) => ({ roleKey: r.role, companyId: r.companyId ?? '' })));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => appApi(`/api/core/members/${member.id}/roles`, { method: 'PUT', body: { roles: rows.filter((r) => r.roleKey).map((r) => ({ roleKey: r.roleKey, companyId: r.companyId || null })) } }),
    onSuccess: () => {
      toast('نقش‌های کاربر ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const status = useMutation({
    mutationFn: (s: 'active' | 'disabled') => appApi(`/api/core/members/${member.id}/status`, { method: 'POST', body: { status: s } }),
    onSuccess: (_d, s) => {
      toast(s === 'active' ? 'کاربر فعال شد' : 'کاربر غیرفعال شد؛ دیگر نمی‌تواند وارد سازمان شود');
      void qc.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`نقش‌های ${member.full_name}`}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          {member.status === 'active' ? (
            <Button variant="ghost" className="text-danger" loading={status.isPending} onClick={() => status.mutate('disabled')}>
              غیرفعال‌سازی کاربر
            </Button>
          ) : (
            <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate('active')}>
              فعال‌سازی کاربر
            </Button>
          )}
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            ذخیره نقش‌ها
          </Button>
        </div>
      }
    >
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      <PageState query={roles}>
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <Field label="نقش" className="min-w-40 flex-1">
                <Select value={r.roleKey} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, roleKey: e.target.value } : x)))}>
                  <option value="">انتخاب کنید</option>
                  {roles.data?.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {me.companies.length > 1 && (
                <Field label="شرکت" className="min-w-36">
                  <Select value={r.companyId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, companyId: e.target.value } : x)))}>
                    <option value="">همه شرکت‌ها</option>
                    {me.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Button variant="ghost" size="sm" aria-label="حذف این نقش" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setRows([...rows, { roleKey: '', companyId: '' }])}>
          <Plus className="size-4" /> افزودن نقش
        </Button>
      </PageState>
    </Dialog>
  );
}
