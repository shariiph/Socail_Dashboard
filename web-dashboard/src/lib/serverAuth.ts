import { cookies } from 'next/headers';

export const AUTH_COOKIE = 'wallet_hub_session';

export function expectedUsername(): string {
  return process.env.DASHBOARD_USERNAME || '';
}

export function expectedPassword(): string {
  return process.env.DASHBOARD_PASSWORD || '';
}

export function sessionSecret(): string {
  return process.env.DASHBOARD_AUTH_SECRET || '';
}

export function authConfigured(): boolean {
  // Login can be backed by env credentials, Supabase admin_users, or runtime store.
  // The only universal requirement is a session signing secret.
  // Keep this aligned with middleware/authToken, which only require a non-empty value.
  return Boolean(sessionSecret());
}

export function hasValidSessionCookie(): boolean {
  const val = cookies().get(AUTH_COOKIE)?.value || '';
  const secret = sessionSecret();
  return Boolean(secret) && val === secret;
}
