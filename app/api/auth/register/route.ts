import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { hashPassword, createSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { username, email, password, full_name } = await req.json();

    if (!username?.trim() || !email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: 'Vui lòng điền đầy đủ thông tin.' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Mật khẩu phải có ít nhất 6 ký tự.' }, { status: 400 });
    }

    // Check duplicates
    const existing = db
      .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
      .get(username.trim(), email.trim());
    if (existing) {
      return NextResponse.json({ error: 'Username hoặc email đã tồn tại.' }, { status: 409 });
    }

    const hashed = await hashPassword(password);
    const result = db
      .prepare('INSERT INTO users (username, email, password, full_name) VALUES (?, ?, ?, ?)')
      .run(username.trim(), email.trim().toLowerCase(), hashed, full_name?.trim() || null);

    await createSession(result.lastInsertRowid as number);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Lỗi server.' }, { status: 500 });
  }
}
