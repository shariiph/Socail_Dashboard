import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/serverAuth';
import { verifySessionToken } from '@/lib/authToken';
import { getAllowedIps, setAllowedIps } from '@/lib/securitySettingsStore';
import { writeAudit } from '@/lib/securityAudit';

function jsonNoStore(body: unknown, status = 200): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function clientIp(req: NextRequest): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || 'unknown';
}

async function ensureSession(req: NextRequest): Promise<{ ok: true; username: string } | { ok: false }> {
  const token = req.cookies.get(AUTH_COOKIE)?.value || '';
  const session = await verifySessionToken(token);
  if (!session.ok || !session.username) return { ok: false };
  return { ok: true, username: session.username };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await ensureSession(req);
    if (!auth.ok) return jsonNoStore({ error: 'Unauthorized' }, 401);
    const ips = await getAllowedIps();
    return jsonNoStore({ allowedIps: ips });
  } catch (e) {
    console.error('[security/settings:get]', e);
    return jsonNoStore({ error: 'Could not load security settings.' }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await ensureSession(req);
    if (!auth.ok) return jsonNoStore({ error: 'Unauthorized' }, 401);
    const ip = clientIp(req);
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body?.allowedIps) ? body.allowedIps : [];
    const ips = raw
      .map((v: unknown) => String(v).trim())
      .filter((v: string) => v.length > 0);
    const result = await setAllowedIps(ips);
    if (!result.ok) {
      const message = 'error' in result ? result.error : 'Could not save settings.';
      await writeAudit('security_settings_update', false, message, ip);
      return jsonNoStore({ error: message }, 400);
    }
    await writeAudit('security_settings_update', true, `allowed_ips:${ips.length}`, ip);
    return jsonNoStore({ ok: true, allowedIps: ips });
  } catch (e) {
    console.error('[security/settings:post]', e);
    return jsonNoStore({ error: 'Could not save security settings.' }, 500);
  }
}

