import { getSupabaseAdmin } from '@/lib/serverSupabaseAdmin';

export async function writeAudit(
  eventType: string,
  success: boolean,
  detail: string,
  ip: string
): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return;
    await sb.from('admin_audit_logs').insert({
      event_type: eventType,
      success,
      detail,
      ip_address: ip,
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort audit logging only; auth flow should not fail if audit fails.
  }
}

