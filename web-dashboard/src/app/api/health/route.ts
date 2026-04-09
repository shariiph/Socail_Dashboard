import { NextResponse } from 'next/server';
import { authConfigured } from '@/lib/serverAuth';
import { getSupabaseAdmin } from '@/lib/serverSupabaseAdmin';

export async function GET() {
  const admin = getSupabaseAdmin();
  let tableCounts: Record<string, number | null> | undefined;
  if (admin) {
    const tables = ['messages', 'sms_messages', 'phone_calls'] as const;
    const entries = await Promise.all(
      tables.map(async (t) => {
        const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true });
        return [t, error ? null : (count ?? 0)] as const;
      })
    );
    tableCounts = Object.fromEntries(entries);
  }

  const res = NextResponse.json({
    ok: true,
    authConfigured: authConfigured(),
    supabaseAdminConfigured: !!admin,
    tableCounts: tableCounts ?? null,
    ts: new Date().toISOString(),
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

