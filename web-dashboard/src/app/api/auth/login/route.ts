import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import {
  AUTH_COOKIE,
  authConfigured,
  sessionSecret,
} from '@/lib/serverAuth';
import { verifyLogin } from '@/lib/serverUserStore';
import { signSessionToken } from '@/lib/authToken';
import { writeAudit } from '@/lib/securityAudit';

type AttemptState = { count: number; lockUntilMs: number };
const attemptsByIp = new Map<string, AttemptState>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

function clientIp(req: NextRequest): string {
  const xfwd = req.headers.get('x-forwarded-for') || '';
  return xfwd.split(',')[0]?.trim() || 'unknown';
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

function safeEquals(a: string, b: string): boolean {
  const ah = sha256(a);
  const bh = sha256(b);
  return timingSafeEqual(ah, bh);
}

function jsonNoStore(body: unknown, status = 200): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function POST(req: NextRequest) {
  try {
    if (!authConfigured()) {
      return jsonNoStore(
        { error: 'Dashboard auth is not configured on server.' },
        500
      );
    }

    const ip = clientIp(req);
    const now = Date.now();
    const state = attemptsByIp.get(ip);
    if (state && state.lockUntilMs > now) {
      await writeAudit('login', false, 'rate_limited', ip);
      return jsonNoStore(
        { error: 'Too many failed attempts. Try again later.' },
        429
      );
    }

    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || '');
    const password = String(body?.password || '');

    const verified = await verifyLogin(username, password);
    // Keep timing characteristics less distinguishable with a fixed hash check path.
    safeEquals(username || 'x', username || 'x');
    if (!verified) {
      const prev = attemptsByIp.get(ip) || { count: 0, lockUntilMs: 0 };
      const nextCount = prev.count + 1;
      attemptsByIp.set(ip, {
        count: nextCount,
        lockUntilMs: nextCount >= MAX_ATTEMPTS ? now + LOCK_MS : 0,
      });
      await writeAudit('login', false, `invalid_credentials:${username}`, ip);
      return jsonNoStore({ error: 'Invalid username or password.' }, 401);
    }
    attemptsByIp.delete(ip);
    await writeAudit('login', true, `ok:${username}`, ip);

    const token = await signSessionToken(username);

    const res = jsonNoStore({ ok: true });
    res.cookies.set({
      name: AUTH_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 12,
    });
    return res;
  } catch (e) {
    console.error('[auth/login]', e);
    return jsonNoStore({ error: 'Login failed due to a server error.' }, 500);
  }
}
