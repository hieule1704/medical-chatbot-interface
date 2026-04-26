import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

// POST /api/conversations/[id]/messages — save a message
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const { id } = await params;
  const convId = parseInt(id, 10);

  // Verify ownership
  const conv = db
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(convId, user.id);
  if (!conv) return NextResponse.json({ error: 'Không tìm thấy.' }, { status: 404 });

  const { role, content } = await req.json();
  if (!role || !content?.trim()) {
    return NextResponse.json({ error: 'Thiếu dữ liệu.' }, { status: 400 });
  }

  const result = db
    .prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(convId, role, content.trim());

  // Update conversation updated_at
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(convId);

  return NextResponse.json({ id: result.lastInsertRowid });
}
