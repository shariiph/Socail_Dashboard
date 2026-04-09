import { SignJWT, jwtVerify } from 'jose';
import { sessionSecret } from '@/lib/serverAuth';

const ENC = new TextEncoder();

export async function signSessionToken(username: string): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error('Missing DASHBOARD_AUTH_SECRET');
  return await new SignJWT({ sub: username, type: 'dashboard-session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(ENC.encode(secret));
}

export async function verifySessionToken(token: string): Promise<{ ok: boolean; username?: string }> {
  try {
    const secret = sessionSecret();
    if (!secret || !token) return { ok: false };
    const verified = await jwtVerify(token, ENC.encode(secret));
    const sub = verified.payload?.sub;
    return typeof sub === 'string' ? { ok: true, username: sub } : { ok: false };
  } catch {
    return { ok: false };
  }
}

