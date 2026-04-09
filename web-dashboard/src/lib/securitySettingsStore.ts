import { getSupabaseAdmin } from '@/lib/serverSupabaseAdmin';

const KEY_ALLOWED_IPS = 'allowed_ips';

function parseIps(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => String(v).trim())
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function envFallbackIps(): string[] {
  return (process.env.DASHBOARD_ALLOWED_IPS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function getAllowedIps(): Promise<string[]> {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return envFallbackIps();
    const { data, error } = await sb
      .from('admin_security_settings')
      .select('value')
      .eq('key', KEY_ALLOWED_IPS)
      .maybeSingle();
    if (error || !data) return envFallbackIps();
    return parseIps((data as { value?: unknown }).value);
  } catch {
    return envFallbackIps();
  }
}

export async function setAllowedIps(ips: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) {
      return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is required for runtime settings updates.' };
    }
    const { error } = await sb.from('admin_security_settings').upsert(
      {
        key: KEY_ALLOWED_IPS,
        value: ips,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
    if (error) return { ok: false, error: error.message || 'Could not save settings.' };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save settings.' };
  }
}

