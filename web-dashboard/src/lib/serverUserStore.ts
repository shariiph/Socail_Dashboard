import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/serverSupabaseAdmin';

type StoredUser = {
  username: string;
  passwordHash: string;
  salt: string;
  updatedAt: string;
};

const FILE_PATH = path.join(process.cwd(), '.runtime-auth.json');
const KEY_LEN = 64;

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_LEN).toString('hex');
}

function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

async function readStoredUser(): Promise<StoredUser | null> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoredUser;
    if (!parsed?.username || !parsed?.passwordHash || !parsed?.salt) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readDbUser(username: string): Promise<StoredUser | null> {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return null;
    const { data, error } = await sb
      .from('admin_users')
      .select('username,password_hash,salt,is_active')
      .eq('username', username)
      .single();
    if (error || !data || data.is_active === false) return null;
    return {
      username: String(data.username),
      passwordHash: String(data.password_hash),
      salt: String(data.salt),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function verifyLogin(username: string, password: string): Promise<boolean> {
  const dbUser = await readDbUser(username);
  if (dbUser) {
    return verifyPassword(password, dbUser.salt, dbUser.passwordHash);
  }
  const stored = await readStoredUser();
  if (stored) {
    if (username !== stored.username) return false;
    return verifyPassword(password, stored.salt, stored.passwordHash);
  }
  const envUser = process.env.DASHBOARD_USERNAME || '';
  const envPass = process.env.DASHBOARD_PASSWORD || '';
  return username === envUser && password === envPass;
}

export async function updateCredentials(
  currentUsername: string,
  currentPassword: string,
  newUsername: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newUsername.trim().length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters.' };
  }
  if (newPassword.length < 12) {
    return { ok: false, error: 'Password must be at least 12 characters.' };
  }
  const verified = await verifyLogin(currentUsername, currentPassword);
  if (!verified) {
    return { ok: false, error: 'Current credentials are incorrect.' };
  }

  try {
    const sb = getSupabaseAdmin();
    if (sb) {
      const existing = await readDbUser(currentUsername);
      if (existing) {
        const saltDb = randomBytes(16).toString('hex');
        const hashDb = hashPassword(newPassword, saltDb);
        const { error } = await sb
          .from('admin_users')
          .update({
            username: newUsername.trim(),
            password_hash: hashDb,
            salt: saltDb,
            updated_at: new Date().toISOString(),
          })
          .eq('username', currentUsername);
        if (!error) return { ok: true };
      }
    }
  } catch {
    // Fall through to file-backed update.
  }

  const salt = randomBytes(16).toString('hex');
  const rec: StoredUser = {
    username: newUsername.trim(),
    passwordHash: hashPassword(newPassword, salt),
    salt,
    updatedAt: new Date().toISOString(),
  };
  try {
    await fs.writeFile(FILE_PATH, JSON.stringify(rec, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        'Could not persist updated credentials on this host. Update env vars manually instead.',
    };
  }
}

