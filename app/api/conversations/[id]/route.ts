import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

function ownsConversation(userId: number, convId: number) {
  return db
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(convId, userId);
}

// GET /api/conversations/[id] — load messages
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const { id } = await params;
  const convId = parseInt(id, 10);
  if (!ownsConversation(user.id, convId)) {
    return NextResponse.json({ error: 'Không tìm thấy.' }, { status: 404 });
  }

  const messages = db
    .prepare('SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(convId);

  return NextResponse.json({ messages });
}

// PATCH /api/conversations/[id] — rename title
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const { id } = await params;
  const convId = parseInt(id, 10);
  if (!ownsConversation(user.id, convId)) {
    return NextResponse.json({ error: 'Không tìm thấy.' }, { status: 404 });
  }

  const { title } = await req.json();
  db.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title?.trim() || 'Cuộc trò chuyện mới', convId);

  return NextResponse.json({ ok: true });
}

// DELETE /api/conversations/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const { id } = await params;
  const convId = parseInt(id, 10);
  if (!ownsConversation(user.id, convId)) {
    return NextResponse.json({ error: 'Không tìm thấy.' }, { status: 404 });
  }

  db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
  return NextResponse.json({ ok: true });
}
