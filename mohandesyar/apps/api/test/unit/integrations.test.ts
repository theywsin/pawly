import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/core/integrations/integration.service.js';
import { assertPublicTarget, isPrivateAddress } from '../../src/core/integrations/net.js';

describe('integrations', () => {
  it('recognises internal addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '185.143.232.1', '2a01:4f8::1']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it('refuses http and internal targets unless allowed', async () => {
    await expect(assertPublicTarget('http://example.com/hook', false)).rejects.toThrow('https');
    await expect(assertPublicTarget('https://127.0.0.1/hook', false)).rejects.toThrow('شبکه داخلی');
    await expect(assertPublicTarget('https://[::1]/hook', false)).rejects.toThrow('شبکه داخلی');
    await expect(assertPublicTarget('http://127.0.0.1:9/hook', true)).resolves.toBeUndefined();
  });
  it('signs the timestamp and body with HMAC-SHA256', () => {
    const body = '{"type":"core.ping"}';
    expect(signature('whsec_x', body, 1700000000)).toBe(`t=1700000000,v1=${createHmac('sha256', 'whsec_x').update(`1700000000.${body}`).digest('hex')}`);
  });
});

describe('download names', async () => {
  const { contentDisposition } = await import('../../src/core/files/file.service.js');
  it('adds an ASCII fallback and keeps the UTF-8 name', () => {
    expect(contentDisposition('mom-014.pdf')).toBe(`attachment; filename="mom-014.pdf"; filename*=UTF-8''mom-014.pdf`);
    expect(contentDisposition('حوادث هفتگی.xlsx')).toBe(`attachment; filename="download.xlsx"; filename*=UTF-8''${encodeURIComponent('حوادث هفتگی.xlsx')}`);
    expect(contentDisposition('گزارش 2026-10-10 - 2026-10-16.xlsx')).toMatch(/^attachment; filename="2026-10-10 - 2026-10-16.xlsx";/);
  });
});
