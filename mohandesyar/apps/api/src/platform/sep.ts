/**
 * Saman Electronic Payment (SEP, «سپ») internet payment gateway, REST protocol:
 *
 *  1. token   POST {base}/onlinepg/onlinepg  {action:"token", TerminalId, Amount, ResNum, RedirectUrl}
 *             → {status: 1, token} | {status: -1, errorCode, errorDesc}
 *  2. payer   is sent to {base}/OnlinePG/SendToken?token=…; after paying, the bank POSTs a form to
 *             RedirectUrl with State, Status, RefNum, ResNum, Amount, TraceNo, RRN, SecurePan, TerminalId…
 *  3. verify  POST {base}/verifyTxnRandomSessionkey/ipg/VerifyTransaction {RefNum, TerminalNumber}
 *             → {ResultCode: 0, Success: true, TransactionDetail: {OrginalAmount, AffectiveAmount, RRN, MaskedPan, StraceNo, …}}
 *     Without a successful verify the bank returns the money to the payer (about 30 minutes later).
 *  4. reverse POST {base}/verifyTxnRandomSessionkey/ipg/ReverseTransaction {RefNum, TerminalNumber}
 *
 * The callback itself proves nothing (anyone can post a form): only the server-to-server verify decides,
 * and the verified amount must equal the expected amount.
 */
export const SEP_LIVE_BASE = 'https://sep.shaparak.ir';

export interface SepCallback {
  State?: string;
  Status?: string;
  RefNum?: string;
  ResNum?: string;
  TerminalId?: string;
  TraceNo?: string;
  Rrn?: string;
  RRN?: string;
  SecurePan?: string;
  Amount?: string;
}

export interface SepVerified {
  ok: boolean;
  /** 0 = verified now; 2 = already verified (a repeated verify). */
  resultCode: number;
  amount: bigint | null;
  rrn: string | null;
  maskedPan: string | null;
  traceNo: string | null;
  message: string;
}

/** Persian messages for the gateway's token error codes (shown to the payer). */
const TOKEN_ERRORS: Record<string, string> = {
  '5': 'پارامترهای ارسالی به درگاه نامعتبر است',
  '8': 'آدرس سرور پذیرنده نامعتبر است',
  '10': 'شماره ترمینال درگاه نامعتبر است',
  '11': 'دسترسی پذیرنده به درگاه غیرفعال است',
  '12': 'آدرس بازگشت با آدرس ثبت‌شده در بانک یکسان نیست',
  '21': 'شماره ترمینال درگاه نامعتبر است',
};

export class SepClient {
  constructor(
    private readonly terminalId: string,
    private readonly base = SEP_LIVE_BASE,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post(path: string, body: object): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`SEP ${path}: HTTP ${res.status}, not JSON`);
    }
  }

  async token(input: { amount: bigint; resNum: string; redirectUrl: string; cellNumber?: string | null }): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
    const r = await this.post('/onlinepg/onlinepg', {
      action: 'token',
      TerminalId: this.terminalId,
      Amount: Number(input.amount),
      ResNum: input.resNum,
      RedirectUrl: input.redirectUrl,
      ...(input.cellNumber ? { CellNumber: input.cellNumber } : {}),
    });
    if (Number(r.status) === 1 && typeof r.token === 'string' && r.token) return { ok: true, token: r.token };
    const code = String(r.errorCode ?? '');
    return { ok: false, message: TOKEN_ERRORS[code] ?? (typeof r.errorDesc === 'string' && r.errorDesc ? r.errorDesc : 'دریافت توکن از درگاه بانک ممکن نشد') };
  }

  payUrl(token: string): string {
    return `${this.base}/OnlinePG/SendToken?token=${encodeURIComponent(token)}`;
  }

  async verify(refNum: string): Promise<SepVerified> {
    const r = await this.post('/verifyTxnRandomSessionkey/ipg/VerifyTransaction', { RefNum: refNum, TerminalNumber: Number(this.terminalId) });
    const code = Number(r.ResultCode);
    const d = (r.TransactionDetail ?? {}) as Record<string, unknown>;
    const amount = d.OrginalAmount ?? d.OriginalAmount;
    return {
      ok: r.Success === true && (code === 0 || code === 2),
      resultCode: code,
      amount: amount === undefined || amount === null ? null : BigInt(String(amount)),
      rrn: d.RRN ? String(d.RRN) : null,
      maskedPan: d.MaskedPan ? String(d.MaskedPan) : null,
      traceNo: d.StraceNo ? String(d.StraceNo) : null,
      message: typeof r.ResultDescription === 'string' ? r.ResultDescription : '',
    };
  }

  async reverse(refNum: string): Promise<boolean> {
    const r = await this.post('/verifyTxnRandomSessionkey/ipg/ReverseTransaction', { RefNum: refNum, TerminalNumber: Number(this.terminalId) });
    return r.Success === true;
  }
}

/** The payer reached the callback after a successful payment at the bank (still to be verified). */
export function callbackPaid(c: SepCallback): boolean {
  return c.State === 'OK' || c.Status === '2';
}
