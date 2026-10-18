import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hashPassword, hotp, passwordPolicyError, totp, verifyPassword, verifyTotp } from '../../src/core/auth/crypto.js';
import { Jwt } from '../../src/core/auth/jwt.js';

describe('auth crypto', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    // RFC 6238 Appendix B (8 digits)
    expect(totp(secret, 59_000, 8)).toBe('94287082');
    expect(totp(secret, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totp(secret, 2_000_000_000_000, 8)).toBe('69279037');
    // RFC 4226 Appendix D HOTP values
    expect(hotp(Buffer.from('12345678901234567890'), 0)).toBe('755224');
    expect(hotp(Buffer.from('12345678901234567890'), 9)).toBe('520489');
  });

  it('verifies TOTP within ±1 step only', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const t = 1_700_000_000_000;
    expect(verifyTotp(secret, totp(secret, t), t)).toBe(true);
    expect(verifyTotp(secret, totp(secret, t - 30_000), t)).toBe(true);
    expect(verifyTotp(secret, totp(secret, t - 90_000), t)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', t)).toBe(false);
  });

  it('round-trips base32', () => {
    const b = Buffer.from([0, 1, 2, 250, 255, 7]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
  });

  it('hashes passwords with argon2id', async () => {
    const h = await hashPassword('correct horse 42');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'correct horse 42')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword('garbage', 'x')).toBe(false);
  });

  it('enforces the password policy', () => {
    expect(passwordPolicyError('short1')).not.toBeNull();
    expect(passwordPolicyError('onlyletterslong')).not.toBeNull();
    expect(passwordPolicyError('رمزعبورقوی۱۲۳۴')).toBeNull();
    expect(passwordPolicyError('goodpassword1')).toBeNull();
  });

  it('encrypts secrets with authenticated encryption', () => {
    const key = 'a'.repeat(64);
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(decryptSecret(enc, key)).toBe('JBSWY3DPEHPK3PXP');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => decryptSecret(enc, 'b'.repeat(64))).toThrow();
  });

  it('issues audience-bound JWTs', async () => {
    const jwt = new Jwt('x'.repeat(40));
    const token = await jwt.sign({ sub: 'u1', sid: 's1', aud: 'app', tid: 't1', amr: ['pwd'] });
    expect((await jwt.verify(token, 'app')).tid).toBe('t1');
    await expect(jwt.verify(token, 'console')).rejects.toThrow();
    await expect(new Jwt('y'.repeat(40)).verify(token, 'app')).rejects.toThrow();
  });
});
