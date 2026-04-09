import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/serverAuth';
import { verifySessionToken } from '@/lib/authToken';
import { getSupabaseAdmin } from '@/lib/serverSupabaseAdmin';

export const dynamic = 'force-dynamic';

function jsonNoStore(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/**
 * Load social notification rows from public.messages using the service role so the dashboard
 * sees data even when RLS blocks the browser anon key.
 * On any server/Supabase failure we return 503 + fallbackToAnon so the UI never shows a bare
 * "Internal Server Error" and the client can fall back to the browser Supabase key.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(AUTH_COOKIE)?.value || '';
    const session = await verifySessionToken(token);
    if (!session.ok) return jsonNoStore({ error: 'Unauthorized' }, 401);

    const admin = getSupabaseAdmin();
    if (!admin) {
      return jsonNoStore(
        {
          error:
            'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is not set on the server (e.g. Netlify env vars).',
          fallbackToAnon: true,
        },
        503
      );
    }

    const raw = req.nextUrl.searchParams.get('limit') || '100';
    const n = parseInt(raw, 10);
    const limit = Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : 100;

    const { data, error } = await admin
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      const detail = [
        error.message,
        error.code ? `code ${error.code}` : '',
        error.details ? String(error.details) : '',
        error.hint ? `hint: ${error.hint}` : '',
      ]
        .filter(Boolean)
        .join(' — ');
      return jsonNoStore(
        {
          error:
            detail ||
            'Supabase query failed (check service role key is the secret/service key, not the publishable anon key).',
          fallbackToAnon: true,
        },
        503
      );
    }

    return jsonNoStore({ messages: data ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonNoStore({ error: msg || 'Unexpected server error', fallbackToAnon: true }, 503);
  }
}
