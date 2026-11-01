import { describe, expect, it } from 'vitest';
import { monthsUntil, vatOf } from '../../src/platform/billing.service.js';
import { callbackPaid, SepClient } from '../../src/platform/sep.js';

describe('billing arithmetic', () => {
  it('rounds VAT half-up to whole rials with bigint math', () => {
    expect(vatOf(10_000_000n, 10)).toBe(1_000_000n);
    expect(vatOf(1234n, 9)).toBe(111n); // 111.06
    expect(vatOf(1250n, 9)).toBe(113n); // 112.5 → 113
    expect(vatOf(999_999_999_999_999n, 10)).toBe(100_000_000_000_000n); // 99_999_999_999_999.9
    expect(vatOf(5000n, 0)).toBe(0n);
    expect(vatOf(100n, 9.5)).toBe(10n); // 9.5
  });

  it('counts started calendar months until the end of the subscription', () => {
    const now = new Date('2026-01-31T10:00:00Z');
    expect(monthsUntil(now, new Date('2026-03-03T10:00:00Z'))).toBe(1); // a one-month period (31 Jan + 1 month)
    expect(monthsUntil(now, new Date('2026-03-20T10:00:00Z'))).toBe(2);
    expect(monthsUntil(now, new Date('2026-02-02T10:00:00Z'))).toBe(1);
    expect(monthsUntil(now, new Date('2027-01-31T10:00:00Z'))).toBe(12);
  });
});

describe('SEP client', () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fake = (reply: (path: string) => object) =>
    (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(reply(new URL(url).pathname)));
    }) as unknown as typeof fetch;

  it('requests a token with the protocol fields and builds the payment URL', async () => {
    const c = new SepClient('12345678', 'https://sep.example', fake(() => ({ status: 1, token: 'abc' })));
    const r = await c.token({ amount: 11_000_000n, resNum: 'res-1', redirectUrl: 'https://site.ir/cb' });
    expect(r).toEqual({ ok: true, token: 'abc' });
    expect(calls.at(-1)).toEqual({ url: 'https://sep.example/onlinepg/onlinepg', body: { action: 'token', TerminalId: '12345678', Amount: 11000000, ResNum: 'res-1', RedirectUrl: 'https://site.ir/cb' } });
    expect(c.payUrl('a b')).toBe('https://sep.example/OnlinePG/SendToken?token=a%20b');
  });

  it('maps token errors to Persian messages', async () => {
    const c = new SepClient('1', 'https://sep.example', fake(() => ({ status: -1, errorCode: 12, errorDesc: 'Invalid redirect' })));
    expect(await c.token({ amount: 1n, resNum: 'r', redirectUrl: 'x' })).toEqual({ ok: false, message: 'آدرس بازگشت با آدرس ثبت‌شده در بانک یکسان نیست' });
  });

  it('reads the verified amount and treats a repeated verify (code 2) as success', async () => {
    const c = new SepClient('12345678', 'https://sep.example', fake(() => ({ ResultCode: 2, Success: true, TransactionDetail: { OrginalAmount: 11000000, RRN: '14000', MaskedPan: '6219****1234', StraceNo: '99' } })));
    const v = await c.verify('REF');
    expect(v).toMatchObject({ ok: true, resultCode: 2, amount: 11_000_000n, rrn: '14000', maskedPan: '6219****1234', traceNo: '99' });
    expect(calls.at(-1)).toEqual({ url: 'https://sep.example/verifyTxnRandomSessionkey/ipg/VerifyTransaction', body: { RefNum: 'REF', TerminalNumber: 12345678 } });
    const bad = new SepClient('1', 'https://sep.example', fake(() => ({ ResultCode: -2, Success: false, ResultDescription: 'یافت نشد' })));
    expect((await bad.verify('X')).ok).toBe(false);
  });

  it('only a State of OK (or Status 2) counts as paid at the callback', () => {
    expect(callbackPaid({ State: 'OK' })).toBe(true);
    expect(callbackPaid({ Status: '2' })).toBe(true);
    expect(callbackPaid({ State: 'CanceledByUser', Status: '1' })).toBe(false);
    expect(callbackPaid({})).toBe(false);
  });
});
