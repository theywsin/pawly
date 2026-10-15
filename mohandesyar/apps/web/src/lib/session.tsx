import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HostContext, type HostApi, type MeData } from '@mohandesyar/module-sdk/web';
import { Spinner } from '@mohandesyar/ui';
import { appApi, consoleApi, getToken, onSessionLost, refresh, setCompany, type Realm } from './api.js';

function useBootstrap(realm: Realm): 'checking' | 'ok' | 'anonymous' {
  const [state, setState] = useState<'checking' | 'ok' | 'anonymous'>(getToken(realm) ? 'ok' : 'checking');
  useEffect(() => {
    if (state !== 'checking') return;
    void refresh(realm).then((ok) => setState(ok ? 'ok' : 'anonymous'));
  }, [realm, state]);
  useEffect(() => onSessionLost((r) => r === realm && setState('anonymous')), [realm]);
  return state;
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
      <Spinner className="size-8 text-primary" />
    </div>
  );
}

const MeContext = createContext<{ me: MeData; switchCompany(id: string): void } | null>(null);

export function useAppSession() {
  const c = useContext(MeContext);
  if (!c) throw new Error('outside AppSession');
  return c;
}

/** Guards /app: restores the session from the refresh cookie and loads `me` (modules, permissions, menu). */
export function AppSession({ children }: { children: ReactNode }) {
  const status = useBootstrap('app');
  const location = useLocation();
  const qc = useQueryClient();
  const [company, setCompanyState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('my.company');
    } catch {
      return null;
    }
  });
  setCompany(company);
  const me = useQuery({ queryKey: ['me', company], queryFn: () => appApi<MeData>('/api/core/me'), enabled: status === 'ok', staleTime: 30_000 });
  const switchCompany = useCallback(
    (id: string) => {
      try {
        sessionStorage.setItem('my.company', id);
      } catch {
        /* ignore */
      }
      setCompany(id);
      setCompanyState(id);
      void qc.invalidateQueries();
    },
    [qc],
  );
  const host = useMemo<HostApi | null>(() => (me.data ? {
            me: me.data,
            request: (p, i) => appApi(p, i),
            upload: (file, o) => {
              // Fields must precede the file part: the server reads them from the file part's preamble.
              const fd = new FormData();
              fd.append('module', o.module);
              fd.append('confidentiality', o.confidentiality ?? 'internal');
              fd.append('file', file);
              return appApi('/api/core/files', { method: 'POST', raw: fd });
            },
          } : null), [me.data]);
  if (status === 'anonymous') return <Navigate to={`/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (status === 'checking' || me.isPending) return <FullPageSpinner />;
  if (me.isError || !host || !me.data) {
    return (
      <div className="mx-auto mt-24 max-w-md p-6 text-center">
        <p className="font-semibold">بارگذاری اطلاعات حساب ممکن نشد.</p>
        <p className="mt-2 text-sm text-muted">{(me.error as Error)?.message}</p>
        <button className="mt-4 text-primary underline" onClick={() => void me.refetch()}>
          تلاش دوباره
        </button>
      </div>
    );
  }
  return (
    <MeContext.Provider value={{ me: me.data, switchCompany }}>
      <HostContext.Provider value={host}>{children}</HostContext.Provider>
    </MeContext.Provider>
  );
}

export interface AdminProfile {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
}

const AdminContext = createContext<AdminProfile | null>(null);
export function useAdmin(): AdminProfile {
  const a = useContext(AdminContext);
  if (!a) throw new Error('outside ConsoleSession');
  return a;
}

export function ConsoleSession({ children }: { children: ReactNode }) {
  const status = useBootstrap('console');
  const me = useQuery({ queryKey: ['console-me'], queryFn: () => consoleApi<AdminProfile>('/api/console/auth/me'), enabled: status === 'ok' });
  if (status === 'anonymous') return <Navigate to="/console/login" replace />;
  if (status === 'checking' || me.isPending) return <FullPageSpinner />;
  if (!me.data) return <Navigate to="/console/login" replace />;
  return <AdminContext.Provider value={me.data}>{children}</AdminContext.Provider>;
}
