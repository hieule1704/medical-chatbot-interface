import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import db from './db';

const SESSION_COOKIE = 'med_session';
const SALT_ROUNDS = 10;

export type SessionUser = {
  id: number;
  username: string;
  email: string;
  full_name: string | null;
};

// ── Password ────────────────────────────────────────────────────────────────
export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

// ── Session (simple signed cookie storing user id) ──────────────────────────
// For demo purposes: session = base64(userId:timestamp)
// Production would use JWT or server-side sessions.

export async function createSession(userId: number) {
  const payload = Buffer.from(`${userId}:${Date.now()}`).toString('base64');
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, payload, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(SESSION_COOKIE);
    if (!cookie) return null;

    const decoded = Buffer.from(cookie.value, 'base64').toString('utf-8');
    const [userIdStr] = decoded.split(':');
    const userId = parseInt(userIdStr, 10);
    if (isNaN(userId)) return null;

    const user = db
      .prepare('SELECT id, username, email, full_name FROM users WHERE id = ?')
      .get(userId) as SessionUser | undefined;

    return user ?? null;
  } catch {
    return null;
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
