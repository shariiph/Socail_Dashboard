import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/serverAuth';
import { updateCredentials } from '@/lib/serverUserStore';
import { verifySessionToken } from '@/lib/authToken';
import { writeAudit } from '@/lib/securityAudit';

function jsonNoStore(body: unknown, status = 200): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function POST(req: NextRequest) {
  try {
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || 'unknown';
    const cookie = req.cookies.get(AUTH_COOKIE)?.value || '';
    const session = await verifySessionToken(cookie);
    if (!session.ok) {
      await writeAudit('change_credentials', false, 'unauthorized', ip);
      return jsonNoStore({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const currentUsername = String(body?.currentUsername || '');
    const currentPassword = String(body?.currentPassword || '');
    const newUsername = String(body?.newUsername || '');
    const newPassword = String(body?.newPassword || '');

    const result = await updateCredentials(
      currentUsername,
      currentPassword,
      newUsername,
      newPassword
    );
    if (!result.ok) {
      const message = 'error' in result ? result.error : 'Could not update credentials.';
      await writeAudit('change_credentials', false, message, ip);
      return jsonNoStore({ error: message }, 400);
    }
    await writeAudit('change_credentials', true, `updated:${newUsername}`, ip);
    return jsonNoStore({ ok: true });
  } catch (e) {
    console.error('[auth/change-password]', e);
    return jsonNoStore({ error: 'Could not update credentials due to a server error.' }, 500);
  }
}

