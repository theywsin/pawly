import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@mohandesyar/module-sdk/web';
import { appApi, getToken, onSessionLost, setCompany, setToken } from '../src/lib/api.js';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setToken('app', null);
  setCompany(null);
});

describe('API client', () => {
  it('sends the bearer token, company header and CSRF marker', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetch);
    setToken('app', 'tok');
    setCompany('11111111-1111-1111-1111-111111111111');
    await appApi('/api/core/me');
    const headers = fetch.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers['x-company-id']).toBe('11111111-1111-1111-1111-111111111111');
    expect(headers['x-requested-with']).toBe('mohandesyar');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHORIZED' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'new' }))
      .mockResolvedValueOnce(json(200, { value: 1 }));
    vi.stubGlobal('fetch', fetch);
    setToken('app', 'old');
    expect(await appApi('/api/x')).toEqual({ value: 1 });
    expect(fetch.mock.calls[1]![0]).toBe('/api/auth/refresh');
    expect((fetch.mock.calls[2]![1].headers as Record<string, string>).authorization).toBe('Bearer new');
    expect(getToken('app')).toBe('new');
  });

  it('signals session loss when refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(401, { code: 'UNAUTHORIZED', message: 'نیاز به ورود دوباره است' })));
    setToken('app', 'old');
    const lost = vi.fn();
    const off = onSessionLost(lost);
    await expect(appApi('/api/x')).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalledWith('app');
    off();
  });

  it('maps server errors to ApiError with Persian message and details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { code: 'VALIDATION_FAILED', message: 'اطلاعات ارسال‌شده معتبر نیست', details: [{ path: 'title', message: 'عنوان الزامی است' }] })));
    const err = (await appApi('/api/x', { method: 'POST', body: {} }).catch((e) => e)) as ApiError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details).toEqual([{ path: 'title', message: 'عنوان الزامی است' }]);
  });

  it('reports network failures in Persian', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = (await appApi('/api/x').catch((e) => e)) as ApiError;
    expect(err.status).toBe(0);
    expect(err.message).toBe('ارتباط با سرور برقرار نشد');
  });
});
