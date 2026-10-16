import { createContext, useContext, useMemo, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';

/**
 * Frontend SDK for module authors (docs/03 §6). The host SPA provides `HostContext`; module bundles
 * import this file through the import map, so host and modules share one React context.
 */

export interface LocalizedText {
  fa: string;
  en?: string;
}

export interface MeModule {
  id: string;
  version: string;
  mode: 'full' | 'read-only' | 'hidden-keep-data' | 'blocked';
  name: LocalizedText;
  frontend: string | null;
  styles: string[];
  menu: { key: string; label: LocalizedText; icon?: string; path: string; permission?: string; order: number }[];
  routes: { path: string; export: string }[];
  widgets: { key: string; title: LocalizedText; export: string; sizes: string[] }[];
  optionalDependencies: string[];
}

export interface MeData {
  user: { id: string; email: string; fullName: string; totpEnabled: boolean; emailNotifications?: boolean };
  tenant: { id: string; slug: string; name: string; status: string; timezone: string; number_style: 'fa' | 'latn'; onboarding_completed_at?: string | null };
  company: { id: string; ids: string[] };
  companies: { id: string; name: string }[];
  /** Effective subscription state ('expired' once the paid or trial period has ended). */
  subscription?: { status: string | null; planKey: string | null };
  permissions: string[];
  modules: MeModule[];
}

export interface RequestInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface HostApi {
  request<T = unknown>(path: string, init?: RequestInit): Promise<T>;
  /** Uploads a file for a module; the module then attaches it to a record with ctx.files.claim. */
  upload?(file: File, opts: { module: string; confidentiality?: 'internal' | 'confidential' | 'secret' }): Promise<{ id: string; size: number }>;
  me: MeData;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const HostContext = createContext<HostApi | null>(null);

export function useHost(): HostApi {
  const h = useContext(HostContext);
  if (!h) throw new Error('useHost must be used inside the Mohandesyar host application');
  return h;
}

export function useMe(): MeData {
  return useHost().me;
}

/** Whether the current user holds `permission` (UI hint only — the server enforces every request). */
export function useCan(permission: string): boolean {
  return useMe().permissions.includes(permission);
}

/** Whether a module is active for the current tenant (use it to hide optional-dependency features). */
export function useModule(id: string): boolean {
  return useMe().modules.some((m) => m.id === id);
}

export interface ModuleApi {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string): Promise<T>;
}

/** HTTP client bound to the module's API prefix (/api/m/<id>/v<version>). */
export function useModuleApi(moduleId: string, apiVersion = 1): ModuleApi {
  const { request } = useHost();
  return useMemo(() => {
    const base = `/api/m/${moduleId}/v${apiVersion}`;
    return {
      get: (p) => request(`${base}${p}`),
      post: (p, body) => request(`${base}${p}`, { method: 'POST', body }),
      put: (p, body) => request(`${base}${p}`, { method: 'PUT', body }),
      patch: (p, body) => request(`${base}${p}`, { method: 'PATCH', body }),
      del: (p) => request(`${base}${p}`, { method: 'DELETE' }),
    };
  }, [request, moduleId, apiVersion]);
}

export interface WidgetProps {
  moduleId: string;
  widgetKey: string;
  size: 'sm' | 'md' | 'lg';
}

/** Data for a dashboard widget, served by the module's `widgetData` provider. */
export function useWidgetData<T>(moduleId: string, widgetKey: string) {
  const { request, me } = useHost();
  return useQuery({
    queryKey: ['widget', me.company.id, moduleId, widgetKey],
    queryFn: () => request<{ data: T; at: string }>(`/api/core/widgets/${moduleId}/${widgetKey}`),
  });
}

/** Shape of a module frontend bundle: named exports referenced by the manifest. */
export type ModuleWidget = ComponentType<WidgetProps>;

export interface DirectoryUser {
  id: string;
  fullName: string;
  email: string;
}

/** Active members of the organisation (id, name, email) for user pickers and name display. */
export function useDirectory() {
  const { request, me } = useHost();
  const q = useQuery({ queryKey: ['core', 'directory', me.tenant.id], queryFn: () => request<DirectoryUser[]>('/api/core/directory'), staleTime: 60_000 });
  const byId = useMemo(() => new Map((q.data ?? []).map((u) => [u.id, u])), [q.data]);
  return { users: q.data ?? [], isPending: q.isPending, name: (id: string | null | undefined) => (id ? (byId.get(id)?.fullName ?? '—') : '—') };
}
