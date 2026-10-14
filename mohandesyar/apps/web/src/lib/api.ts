import { ApiError, type RequestInit } from '@mohandesyar/module-sdk/web';

/**
 * Two isolated sessions: company users ("app") and platform admins ("console"). Access tokens live
 * only in memory; the refresh token is an httpOnly cookie scoped to the auth path (docs/02 ADR-12).
 */
export type Realm = 'app' | 'console';

const tokens: Record<Realm, string | null> = { app: null, console: null };
const refreshPath: Record<Realm, string> = { app: '/api/auth/refresh', console: '/api/console/auth/refresh' };
const listeners = new Set<(realm: Realm) => void>();
let companyId: string | null = null;

export function setToken(realm: Realm, token: string | null): void {
  tokens[realm] = token;
}
export function getToken(realm: Realm): string | null {
  return tokens[realm];
}
export function setCompany(id: string | null): void {
  companyId = id;
}
export function onSessionLost(fn: (realm: Realm) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toError(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as { code?: string; message?: string; details?: unknown; ref?: string };
  const msg = b.message || (status === 0 ? 'ارتباط با سرور برقرار نشد' : 'خطایی رخ داد');
  return new ApiError(status, b.code ?? 'ERROR', msg, b.details ?? (b.ref ? { ref: b.ref } : undefined));
}

const refreshing: Partial<Record<Realm, Promise<boolean>>> = {};

/** Restores or renews the session from the refresh cookie. Concurrent callers share one request. */
export function refresh(realm: Realm): Promise<boolean> {
  refreshing[realm] ??= (async () => {
    try {
      const res = await fetch(refreshPath[realm], { method: 'POST', credentials: 'same-origin', headers: { 'x-requested-with': 'mohandesyar' } });
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken?: string };
      tokens[realm] = body.accessToken ?? null;
      return !!body.accessToken;
    } catch {
      return false;
    } finally {
      setTimeout(() => delete refreshing[realm], 0);
    }
  })();
  return refreshing[realm]!;
}

export async function request<T = unknown>(realm: Realm, path: string, init: RequestInit & { raw?: BodyInit } = {}): Promise<T> {
  const doFetch = () => {
    const headers: Record<string, string> = { accept: 'application/json', 'x-requested-with': 'mohandesyar', ...(init.headers ?? {}) };
    if (tokens[realm]) headers.authorization = `Bearer ${tokens[realm]}`;
    if (realm === 'app' && companyId) headers['x-company-id'] = companyId;
    let body: BodyInit | undefined = init.raw;
    if (init.body !== undefined && !init.raw) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    return fetch(path, { method: init.method ?? 'GET', headers, body, credentials: 'same-origin', signal: init.signal });
  };
  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw toError(0, null);
  }
  if (res.status === 401 && tokens[realm] && (await refresh(realm))) res = await doFetch();
  const body = await parse(res);
  if (res.status === 401) {
    tokens[realm] = null;
    listeners.forEach((l) => l(realm));
  }
  if (!res.ok) throw toError(res.status, body);
  return body as T;
}

export const appApi = <T = unknown>(path: string, init?: RequestInit & { raw?: BodyInit }) => request<T>('app', path, init);
export const consoleApi = <T = unknown>(path: string, init?: RequestInit & { raw?: BodyInit }) => request<T>('console', path, init);
