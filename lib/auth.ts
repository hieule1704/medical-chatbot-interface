/**
 * lib/auth.ts — Session với JWT signed (thay Base64 không có chữ ký)
 *
 * Dùng thư viện jose (đã có sẵn trong Next.js ecosystem, không cần cài thêm).
 * Secret key đọc từ env JWT_SECRET. Nếu chưa có, fallback về dev-only key
 * và in warning — đủ an toàn cho demo đồ án, không cần config phức tạp.
 */

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import db from './db';

const SESSION_COOKIE = 'med_session';
const SALT_ROUNDS    = 10;
const JWT_EXPIRES    = '7d';

// Lấy secret từ env, fallback về dev key nếu chưa set
function getSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET phải được set trong production!');
    }
    // Dev-only fallback — tự động, không cần config
    console.warn('[auth] ⚠️  JWT_SECRET chưa set — dùng dev key. Không dùng trong production!');
    return new TextEncoder().encode('dev-only-secret-change-in-production-32chars!!');
  }
  return new TextEncoder().encode(raw);
}

export type SessionUser = {
  id       : number;
  username : string;
  email    : string;
  full_name: string | null;
};

// ── Password ─────────────────────────────────────────────────────────────────
export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

// ── Session ───────────────────────────────────────────────────────────────────
export async function createSession(userId: number) {
  const secret = getSecret();

  const token = await new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES)
    .sign(secret);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge  : 60 * 60 * 24 * 7,   // 7 ngày
    path    : '/',
  });
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const cookie      = cookieStore.get(SESSION_COOKIE);
    if (!cookie?.value) return null;

    const secret  = getSecret();
    const { payload } = await jwtVerify(cookie.value, secret);

    const userId = parseInt(payload.sub ?? '', 10);
    if (isNaN(userId)) return null;

    const user = db
      .prepare('SELECT id, username, email, full_name FROM users WHERE id = ?')
      .get(userId) as SessionUser | undefined;

    return user ?? null;
  } catch {
    // Token expired, tampered, or invalid → treat as logged out
    return null;
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}