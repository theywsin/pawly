import { SignJWT, jwtVerify } from 'jose';

export type Audience = 'app' | 'console';

export interface AccessClaims {
  sub: string;
  sid: string;
  aud: Audience;
  /** Tenant (app tokens only). */
  tid?: string;
  /** Authentication methods: ["pwd"] or ["pwd","otp"]. */
  amr: string[];
  /** Time of the last second-factor verification (unix seconds), for "fresh 2FA" checks. */
  otp_at?: number;
}

export const ACCESS_TTL_SECONDS = 10 * 60;

export class Jwt {
  private readonly key: Uint8Array;
  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  sign(claims: AccessClaims, ttl = ACCESS_TTL_SECONDS): Promise<string> {
    const { sub, aud, ...rest } = claims;
    return new SignJWT({ ...rest })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setAudience(aud)
      .setIssuer('mohandesyar')
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.key);
  }

  async verify(token: string, audience: Audience): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.key, { audience, issuer: 'mohandesyar', algorithms: ['HS256'] });
    return payload as unknown as AccessClaims;
  }
}
