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
  return Boolean(
    expectedUsername() &&
      expectedPassword().length >= 12 &&
      sessionSecret().length >= 32
  );
}

export function hasValidSessionCookie(): boolean {
  const val = cookies().get(AUTH_COOKIE)?.value || '';
  const secret = sessionSecret();
  return Boolean(secret) && val === secret;
}
