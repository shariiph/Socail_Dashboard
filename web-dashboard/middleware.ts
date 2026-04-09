import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/authToken';

const AUTH_COOKIE = 'wallet_hub_session';

function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'same-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return res;
}

let cachedAllowedIps: { expiresAt: number; ips: string[] } | null = null;

async function resolveAllowedIps(): Promise<string[]> {
  const now = Date.now();
  if (cachedAllowedIps && cachedAllowedIps.expiresAt > now) {
    return cachedAllowedIps.ips;
  }
  const envIps = (process.env.DASHBOARD_ALLOWED_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceRole) {
    cachedAllowedIps = { ips: envIps, expiresAt: now + 60_000 };
    return envIps;
  }
  try {
    const r = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/admin_security_settings?key=eq.allowed_ips&select=value&limit=1`,
      {
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
      }
    );
    if (!r.ok) throw new Error(`status ${r.status}`);
    const json = (await r.json()) as Array<{ value?: unknown }>;
    const value = json?.[0]?.value;
    const ips = Array.isArray(value)
      ? value.map((v) => String(v).trim()).filter(Boolean)
      : envIps;
    cachedAllowedIps = { ips, expiresAt: now + 60_000 };
    return ips;
  } catch {
    cachedAllowedIps = { ips: envIps, expiresAt: now + 60_000 };
    return envIps;
  }
}

async function ipAllowed(req: NextRequest): Promise<boolean> {
  const allowed = await resolveAllowedIps();
  if (!allowed.length) return true;
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
  return allowed.includes(ip);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico';

  if (isPublic) {
    return withSecurityHeaders(NextResponse.next());
  }

  const secret = process.env.DASHBOARD_AUTH_SECRET || '';
  const cookie = req.cookies.get(AUTH_COOKIE)?.value || '';

  // Fail closed: if auth secret is missing, do not allow dashboard access.
  if (!secret) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (!(await ipAllowed(req))) {
    return withSecurityHeaders(
      new NextResponse('Forbidden', { status: 403 })
    );
  }

  const session = await verifySessionToken(cookie);
  if (session.ok) {
    if (pathname === '/login') {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return withSecurityHeaders(NextResponse.next());
  }

  const loginUrl = new URL('/login', req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
