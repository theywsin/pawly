import { randomBytes } from 'node:crypto';
import type { Redis } from '../infra/redis.js';

/**
 * A stand-in for the SEP bank, speaking the same protocol as the real gateway (token, payment page that
 * posts the result form back, verify, reverse). It exists only when PAYMENT_SANDBOX=true, for testing a
 * deployment end to end before the real terminal is connected. No money is involved.
 */
interface SandboxTxn {
  terminalId: string;
  amount: string;
  resNum: string;
  redirectUrl: string;
  refNum?: string;
  paid?: boolean;
  verified?: boolean;
  reversed?: boolean;
}

const TTL = 3600;
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class SepSandbox {
  constructor(private readonly redis: Redis) {}

  private async get(key: string): Promise<SandboxTxn | null> {
    const v = await this.redis.get(`sepsb:${key}`);
    return v ? (JSON.parse(v) as SandboxTxn) : null;
  }

  private async put(key: string, t: SandboxTxn): Promise<void> {
    await this.redis.set(`sepsb:${key}`, JSON.stringify(t), 'EX', TTL);
  }

  /** JSON API: same paths and payloads as the bank. */
  async api(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (path === '/onlinepg/onlinepg') {
      if (body.action !== 'token' || !body.TerminalId || !(Number(body.Amount) > 0) || !body.ResNum || !body.RedirectUrl) return { status: -1, errorCode: 5, errorDesc: 'پارامترهای ارسالی نامعتبر است' };
      const token = randomBytes(16).toString('hex');
      await this.put(`t:${token}`, { terminalId: String(body.TerminalId), amount: String(body.Amount), resNum: String(body.ResNum), redirectUrl: String(body.RedirectUrl) });
      return { status: 1, token };
    }
    const refNum = String(body.RefNum ?? '');
    const t = await this.get(`r:${refNum}`);
    if (path.endsWith('/VerifyTransaction')) {
      if (!t || !t.paid || t.reversed || String(body.TerminalNumber) !== t.terminalId) return { ResultCode: -2, Success: false, ResultDescription: 'تراکنش یافت نشد' };
      const again = !!t.verified;
      await this.put(`r:${refNum}`, { ...t, verified: true });
      return {
        ResultCode: again ? 2 : 0,
        Success: true,
        ResultDescription: again ? 'درخواست تکراری است' : 'عملیات با موفقیت انجام شد',
        TransactionDetail: { RRN: '14' + refNum.slice(0, 10), RefNum: refNum, MaskedPan: '621986******1234', TerminalNumber: Number(t.terminalId), OrginalAmount: Number(t.amount), AffectiveAmount: Number(t.amount), StraceNo: refNum.slice(-6) },
      };
    }
    if (path.endsWith('/ReverseTransaction')) {
      if (!t || !t.paid) return { ResultCode: -2, Success: false };
      await this.put(`r:${refNum}`, { ...t, reversed: true });
      return { ResultCode: 0, Success: true };
    }
    return { status: -1, errorCode: 404 };
  }

  /**
   * The "bank page": two forms posting the bank's result fields straight to the merchant's callback, as
   * the real gateway does after the payer finishes. The reference number is issued when the page opens.
   */
  async page(token: string): Promise<string | null> {
    const t = await this.get(`t:${token}`);
    if (!t) return null;
    const refNum = randomBytes(12).toString('hex');
    await this.put(`r:${refNum}`, { ...t, refNum, paid: true });
    const paid = { State: 'OK', Status: '2', RefNum: refNum, ResNum: t.resNum, TerminalId: t.terminalId, Amount: t.amount, TraceNo: refNum.slice(-6), Rrn: '14' + refNum.slice(0, 10), SecurePan: '621986******1234', Token: token };
    const canceled = { State: 'CanceledByUser', Status: '1', ResNum: t.resNum, TerminalId: t.terminalId, Token: token };
    const form = (fields: Record<string, string>, label: string, primary: boolean) =>
      `<form method="post" action="${esc(t.redirectUrl)}">${Object.entries(fields)
        .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
        .join('')}` +
      `<button type="submit" style="width:100%;padding:12px;margin-top:10px;border-radius:8px;border:1px solid #0f766e;font:inherit;cursor:pointer;${primary ? 'background:#0f766e;color:#fff' : 'background:#fff;color:#0f766e'}">${label}</button></form>`;
    return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>درگاه آزمایشی</title></head>
<body style="font-family:Vazirmatn,Tahoma,sans-serif;background:#f1f5f9;margin:0;padding:24px">
<main style="max-width:420px;margin:40px auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 4px #0002">
<h1 style="font-size:20px;margin:0 0 8px">درگاه پرداخت آزمایشی</h1>
<p style="color:#b45309;font-size:14px;line-height:1.9">این صفحه بانک واقعی نیست و هیچ پولی جابه‌جا نمی‌شود؛ فقط برای آزمایش سامانه است.</p>
<p>مبلغ: <strong>${Number(t.amount).toLocaleString('fa-IR')} ریال</strong></p>
${form(paid, 'پرداخت موفق', true)}${form(canceled, 'انصراف از پرداخت', false)}
</main></body></html>`;
  }

  /** In-process fetch for the server-to-server calls (verify/reverse/token) in sandbox mode. */
  fetch(): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const path = url.pathname.replace(/^\/api\/sandbox\/sep/, '');
      return new Response(JSON.stringify(await this.api(path, body)), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  }
}
