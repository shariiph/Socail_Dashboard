import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/serverAuth';
import { verifySessionToken } from '@/lib/authToken';
import { writeAudit } from '@/lib/securityAudit';

export async function POST(req: NextRequest) {
  try {
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || 'unknown';
    const token = req.cookies.get(AUTH_COOKIE)?.value || '';
    const session = await verifySessionToken(token);
    await writeAudit('logout', session.ok, session.ok ? `ok:${session.username}` : 'no_session', ip);
    const res = NextResponse.json({ ok: true });
    res.headers.set('Cache-Control', 'no-store');
    res.cookies.set({
      name: AUTH_COOKIE,
      value: '',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return res;
  } catch (e) {
    console.error('[auth/logout]', e);
    return NextResponse.json({ error: 'Logout failed due to a server error.' }, { status: 500 });
  }
}
