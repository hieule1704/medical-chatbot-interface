import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { verifyPassword, createSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username?.trim() || !password?.trim()) {
      return NextResponse.json({ error: 'Vui lòng nhập đầy đủ thông tin.' }, { status: 400 });
    }

    const user = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username.trim()) as { id: number; password: string } | undefined;

    if (!user) {
      return NextResponse.json({ error: 'Username hoặc mật khẩu không đúng.' }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return NextResponse.json({ error: 'Username hoặc mật khẩu không đúng.' }, { status: 401 });
    }

    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Lỗi server.' }, { status: 500 });
  }
}
