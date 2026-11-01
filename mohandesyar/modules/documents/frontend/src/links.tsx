import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Field, Input, Select } from '@mohandesyar/ui';
import { useDirectory, useModule } from '@mohandesyar/module-sdk/web';
import { LINK_TYPE, useApi } from './common.js';

export interface PickedLink { type: string; id: string; label: string }

/** Picks a project, contract, payment request or user to link a document to (only active modules are offered). */
export function LinkPicker({ onPick, projectsOnly }: { onPick: (l: PickedLink) => void; projectsOnly?: boolean }) {
  const a = useApi();
  const dir = useDirectory();
  const has = { project: useModule('projects'), contract: useModule('contracts'), payment: useModule('finance'), user: true };
  const types = (Object.keys(LINK_TYPE) as (keyof typeof has)[]).filter((k) => has[k] && (!projectsOnly || k === 'project'));
  const [type, setType] = useState<string>(types[0] ?? 'user');
  const [q, setQ] = useState('');
  const res = useQuery({
    queryKey: ['documents', 'lookup', type, q],
    queryFn: async (): Promise<{ id: string; label: string }[]> => {
      if (type === 'project') return (await a.get<{ id: string; code: string; title: string }[]>(`/lookups/projects?q=${encodeURIComponent(q)}`)).map((p) => ({ id: p.id, label: `${p.code} — ${p.title}` }));
      if (type === 'contract') return (await a.get<{ id: string; code: string; title: string }[]>(`/lookups/contracts?q=${encodeURIComponent(q)}`)).map((p) => ({ id: p.id, label: `${p.code} — ${p.title}` }));
      if (type === 'payment') return (await a.get<{ id: string; number: number; description: string }[]>(`/lookups/payments?q=${encodeURIComponent(q)}`)).map((p) => ({ id: p.id, label: `پرداخت ${p.number.toLocaleString('fa-IR')} — ${p.description}` }));
      return dir.users.filter((u) => !q || u.fullName.includes(q) || u.email.includes(q)).slice(0, 50).map((u) => ({ id: u.id, label: u.fullName }));
    },
  });
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="نوع اتصال">
        <Select value={type} onChange={(e) => setType(e.target.value)}>{types.map((k) => <option key={k} value={k}>{LINK_TYPE[k]}</option>)}</Select>
      </Field>
      <Field label="جست‌وجو"><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <Field label="انتخاب">
        <Select value="" onChange={(e) => { const r = res.data?.find((x) => x.id === e.target.value); if (r) onPick({ type, id: r.id, label: r.label }); }}>
          <option value="">{res.isPending ? 'در حال بارگذاری…' : (res.data ?? []).length ? 'انتخاب کنید' : 'موردی یافت نشد'}</option>
          {(res.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
      </Field>
    </div>
  );
}
