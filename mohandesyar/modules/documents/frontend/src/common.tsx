import { useState } from 'react';
import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, type Tone } from '@mohandesyar/ui';
import { ApiError, useCan, useModuleApi } from '@mohandesyar/module-sdk/web';

export const useApi = () => useModuleApi('documents');
export const BASE = '/app/documents';

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'پیش‌نویس (بدون نسخه تأییدشده)', tone: 'warning' },
  active: { label: 'معتبر', tone: 'success' },
  obsolete: { label: 'منسوخ', tone: 'neutral' },
  disposed: { label: 'امحاشده', tone: 'danger' },
};
export const VERSION_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'در انتظار تأیید', tone: 'warning' },
  approved: { label: 'نسخه جاری', tone: 'success' },
  rejected: { label: 'ردشده', tone: 'danger' },
  superseded: { label: 'جایگزین‌شده', tone: 'neutral' },
};
export const CONFIDENTIALITY: Record<string, { label: string; tone: Tone }> = {
  internal: { label: 'عادی', tone: 'neutral' },
  confidential: { label: 'محرمانه', tone: 'warning' },
  secret: { label: 'سری', tone: 'danger' },
};
export const LINK_TYPE: Record<string, string> = { project: 'پروژه', contract: 'قرارداد', payment: 'پرداخت', user: 'کاربر' };

export const num = (v: number | string | null | undefined) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('fa-IR'));
export const size = (b: number | string) => {
  const n = Number(b);
  return n >= 1_048_576 ? `${num(Math.round((n / 1_048_576) * 10) / 10)} مگابایت` : `${num(Math.max(1, Math.round(n / 1024)))} کیلوبایت`;
};

export function useServerErrors() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  return {
    fields,
    clear: () => (setFields({}), setGeneral(null)),
    set: (e: unknown) => {
      if (e instanceof ApiError) {
        const d = Array.isArray(e.details) ? (e.details as { path: string; message: string }[]) : [];
        setFields(Object.fromEntries(d.map((x) => [x.path, x.message])));
        setGeneral(d.length ? `${e.message}: ${d[0]!.message}` : e.message);
      } else setGeneral(e instanceof Error ? e.message : 'عملیات انجام نشد؛ دوباره تلاش کنید');
    },
    banner: general ? <Alert tone="danger" className="mb-4">{general}</Alert> : null,
  };
}

export interface Folder { id: string; parent_id: string | null; name: string; documents: number }
export interface Category { id: string; name: string; requires_approval: boolean; retention_policy_id: string | null; policy_name: string | null; years: number | null; archived: boolean }

export const useFolders = () => {
  const a = useApi();
  return useQuery({ queryKey: ['documents', 'folders'], queryFn: () => a.get<Folder[]>('/folders') });
};
export const useCategories = () => {
  const a = useApi();
  return useQuery({ queryKey: ['documents', 'categories'], queryFn: () => a.get<Category[]>('/categories') });
};

/** Folder path such as «فنی / نقشه‌ها», for selects. */
export function folderPaths(folders: Folder[]) {
  const by = new Map(folders.map((f) => [f.id, f]));
  const path = (f: Folder): string => {
    const seen = new Set<string>();
    const parts: string[] = [];
    let cur: Folder | undefined = f;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_id ? by.get(cur.parent_id) : undefined;
    }
    return parts.join(' / ');
  };
  return folders.map((f) => ({ id: f.id, path: path(f), documents: f.documents })).sort((x, y) => x.path.localeCompare(y.path, 'fa'));
}

export function Nav() {
  const admin = useCan('documents.admin');
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های اسناد" className="mb-6 flex gap-1 overflow-x-auto border-b border-border print:hidden">
      <NavLink to={`${BASE}/list`} className={link}>اسناد</NavLink>
      {admin && <NavLink to={`${BASE}/settings`} className={link}>پوشه‌ها، دسته‌ها و نگهداری</NavLink>}
    </nav>
  );
}
