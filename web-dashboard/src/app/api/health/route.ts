import { NextResponse } from 'next/server';
import { authConfigured } from '@/lib/serverAuth';
import { getSupabaseAdmin } from '@/lib/serverSupabaseAdmin';

/** Must run per-request — otherwise build-time or CDN can cache wrong env / counts. */
export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = getSupabaseAdmin();
  let tableCounts: Record<string, number | null> | null = null;
  if (admin) {
    try {
      const tables = ['messages', 'sms_messages', 'phone_calls'] as const;
      const entries = await Promise.all(
        tables.map(async (t) => {
          const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true });
          return [t, error ? null : (count ?? 0)] as const;
        })
      );
      tableCounts = Object.fromEntries(entries);
    } catch {
      tableCounts = null;
    }
  }

  const res = NextResponse.json({
    ok: true,
    authConfigured: authConfigured(),
    supabaseAdminConfigured: !!admin,
    tableCounts,
    ts: new Date().toISOString(),
  });
  res.headers.set('Cache-Control', 'no-store, must-revalidate');
  return res;
}

