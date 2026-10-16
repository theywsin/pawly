import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Badge, Button, Dialog, Field, Input, Ltr, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { appApi } from '../../../lib/api.js';
import { applyServerErrors } from '../../../lib/errors.js';
import { useAppSession } from '../../../lib/session.js';

interface Member {
  id: string;
  email: string;
  full_name: string;
  status: string;
  roles: { role: string; name: string; companyId: string | null }[];
}
interface Role {
  key: string;
  name: string;
}

const schema = z.object({
  fullName: z.string().trim().min(2, 'نام را وارد کنید'),
  email: z.email('ایمیل معتبر وارد کنید'),
  roleKey: z.string().min(1, 'نقش را انتخاب کنید'),
  companyId: z.string(),
  initialPassword: z.string().optional(),
});

export function Members() {
  const { me } = useAppSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['members'], queryFn: () => appApi<Member[]>('/api/core/members') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => appApi<Role[]>('/api/core/roles') });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { companyId: '' } });
  const companyName = (id: string | null) => (id ? (me.companies.find((c) => c.id === id)?.name ?? '—') : 'همه شرکت‌ها');
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await appApi<{ created: boolean }>('/api/core/members', { method: 'POST', body: { ...v, companyId: v.companyId || null, initialPassword: v.initialPassword || undefined } });
      toast(r.created ? 'کاربر ساخته و به سازمان افزوده شد' : 'کاربر موجود به سازمان افزوده شد');
      setOpen(false);
      form.reset({ companyId: '' });
      void qc.invalidateQueries({ queryKey: ['members'] });
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });
  return (
    <>
      <PageHeader title="کاربران و نقش‌ها" actions={me.permissions.includes('core.user.create') && <Button onClick={() => setOpen(true)}>افزودن کاربر</Button>} />
      <PageState query={q} isEmpty={q.data?.length === 0}>
        <Table>
          <thead>
            <tr>
              <Th>نام</Th>
              <Th>ایمیل</Th>
              <Th>نقش‌ها</Th>
              <Th>وضعیت</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium">{m.full_name}</Td>
                <Td>
                  <Ltr>{m.email}</Ltr>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {m.roles.map((r, i) => (
                      <Badge key={i} tone="info">
                        {r.name} · {companyName(r.companyId)}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td>{m.status === 'active' ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      <Dialog open={open} onOpenChange={setOpen} title="افزودن کاربر" description="اگر کاربری با این ایمیل وجود دارد، فقط به سازمان افزوده می‌شود.">
        {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="نام و نام خانوادگی" error={form.formState.errors.fullName?.message} required>
            <Input {...form.register('fullName')} />
          </Field>
          <Field label="ایمیل" error={form.formState.errors.email?.message} required>
            <Input dir="ltr" type="email" {...form.register('email')} />
          </Field>
          <Field label="نقش" error={form.formState.errors.roleKey?.message} required>
            <Select {...form.register('roleKey')}>
              <option value="">انتخاب کنید</option>
              {roles.data?.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="محدوده شرکت">
            <Select {...form.register('companyId')}>
              <option value="">همه شرکت‌ها</option>
              {me.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="رمز اولیه (برای کاربر جدید)" hint="آن را به‌صورت امن به کاربر بدهید؛ کاربر پس از ورود می‌تواند تغییرش دهد." error={form.formState.errors.initialPassword?.message}>
            <Input dir="ltr" type="password" autoComplete="new-password" {...form.register('initialPassword')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              افزودن
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
