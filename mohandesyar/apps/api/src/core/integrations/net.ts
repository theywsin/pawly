import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True for loopback, private, link-local, CGNAT, multicast and unspecified addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
}

/** Rejects webhook targets inside the server's network (SSRF), unless explicitly allowed for development. */
export async function assertPublicTarget(url: string, allowPrivate: boolean): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) throw new Error('فقط نشانی https مجاز است');
  if (allowPrivate) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error('نشانی به شبکه داخلی اشاره می‌کند و مجاز نیست');
}
